// DynaSoar: the page. The maths is in glide-core.js (no DOM); the route search runs in glide-worker.js.
'use strict';
const G = GlideCore, GP = GlidePlan;
const CONTENT = JSON.parse(document.getElementById("glide-content").textContent);
const TS = 256, RT = 3;                   // compute on a 7 × 7 block of terrain tiles round the launch
const Z_MAX = 13, Z_MIN = 9;              // zoom 13 is ~14 m per pixel here; long glides drop to coarser zooms
const SAVE_R = RT + 1, SAVE_R_LOW = RT;   // a saved area: 9 × 9 tiles at zoom 13, 7 × 7 at zooms 12 to 9
const SAVED = 'glide-terrain-saved', RUNTIME = 'glide-terrain-runtime';
const terrUrl = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const M_HILL = { ...CONTENT.landmark, snap: 0 }; // Exact landmark location; never snap a launch onto another peak.
let soaringUI = null, windUI = null;
// Map overlay colours: the site's chart palette (violet, teal, red, gold), checked with the dataviz validator for colour-blind
// separation. `light` for the street, topo and shaded maps; `img` (mid-tone steps, with light lines on dark casings) over
// satellite imagery, where each region also gets a solid outline. `C` is the one in use (restyle()).
const PAL = {
  light: { straight: [90, 79, 214], curve: [18, 165, 153], curveDark: [10, 118, 109], steep: [118, 120, 128], out: [110, 112, 120],
           hit: '#b8263a', route: '#a58d12', flight: '#5a4fd6', line: '#1d1e23', ring: '#1d1e23', casing: '#ffffff',
           a: { out: 42, steep: 85, steepStripe: 60, straight: 110, curve: 105, curveStripe: 185, edge: 235 } },
  img: { straight: [138, 122, 247], curve: [15, 165, 147], curveDark: [8, 112, 100], steep: [232, 233, 238], out: [255, 255, 255],
         hit: '#f2526c', route: '#b08f10', flight: '#8a7af7', line: '#ffffff', ring: '#ffffff', casing: '#1d1e23',
         a: { out: 48, steep: 45, steepStripe: 30, straight: 130, curve: 95, curveStripe: 185, edge: 255 } }
};
let C = PAL.light;
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const SHORT = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (d, long) => (long ? COMPASS : SHORT)[Math.round(d / 45) % 8];

const LS = {
  get(k, d) { try { const v = localStorage.getItem('glide-reach-' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('glide-reach-' + k, JSON.stringify(v)); return true; } catch (e) { return false; } }
};
const $ = id => document.getElementById(id);
const setStatus = (html, source = 'message') => { $('status').innerHTML = html; $('status').dataset.source = source; };
let hadResult = false;
function markCalc(phase, text) {
  $('app').dataset.calc = phase;
  const pending = phase === 'loading' || phase === 'updating';
  $('map').setAttribute('aria-busy', String(pending));
  $('retryTerrain').hidden = !M?.failed && phase !== 'missing';
  $('calcState').textContent = text || CONTENT.calculation[phase];
  $('resultNotice').textContent = pending && hadResult ? 'Previous result shown' : '';
  $('prof').classList.toggle('stale', pending && hadResult);
  if (pending) $('btnFly').disabled = true;
  if ((phase === 'ready' || phase === 'partial') && $('status').dataset.source === 'terrain') placeStatus();
}

if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) navigator.serviceWorker.register('sw.js').catch(() => {});

// Theme colours for the cross-section, read once per theme change rather than on every draw.
let COL = {};
function readColours() {
  const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
  PAL.light.flight=v('--s-straight'); PAL.light.route=v('--s-route');
  COL = { straight: v('--s-straight'), curve: v('--s-curve'), hit: v('--s-hit'), terrain: v('--terrain'), terrainEdge: v('--terrain-edge'),
          line: v('--line'), muted: v('--muted'), ink2: v('--ink-2'), surface2: v('--surface-2'), warn: v('--warn') };
}
readColours();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColours(); restyle(); drawProfile(); mark3d(); });
$('theme').onclick = () => {
  const root = document.documentElement;
  const dark = root.getAttribute('data-theme') ? root.getAttribute('data-theme') === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.setAttribute('data-theme', dark ? 'light' : 'dark');
  try { localStorage.setItem('theme', dark ? 'light' : 'dark'); } catch (e) {}
  readColours(); restyle(); drawProfile(); mark3d();
};

// ---------- Units: sliders work in the chosen system; P always holds metric values ----------
// [min, max, step, unit] per system, and k: the factor from metric to imperial; read-outs come from GlideCore.Units.
const SPEC = GP.SPEC;
let sharedPlan = null, shareError = '';
try { if (location.hash.startsWith('#plan=')) sharedPlan = GP.decode(location.hash.slice(6)); }
catch (err) { shareError = err.message; }
let units = sharedPlan?.units || LS.get('units', (navigator.language || '').toLowerCase() === 'en-us' ? 'imperial' : 'metric');
if (!['metric', 'imperial'].includes(units)) units = 'metric';
let U = G.Units[units];
const P = GP.parameters(sharedPlan?.params || LS.get('params', {}));
let selectedPlan = null, selectedAircraft = null;
let mapHeading = 0, mapPitch = 0;
let pendingTarget = sharedPlan ? sharedPlan.target : undefined;
$('curve').checked = P.curve;

const factor = k => units === 'imperial' ? SPEC[k].k : 1; // metric value × factor = what the slider shows
function setSliders() {
  for (const [k, spec] of Object.entries(SPEC)) {
    const [min, max, step] = spec[units], el = $(k), num = $('n_' + k);
    el.min = min; el.max = max; el.step = step;
    el.value = P[k] * factor(k); // the slider thumb may snap; it never writes back on a unit change
    const [lo, hi] = GP.bounds(k);
    num.min = lo * factor(k); num.max = hi * factor(k); num.step = 'any';
    num.value = GP.display(k, P[k], units); num.setCustomValidity('');
    num.setAttribute('aria-label', `${CONTENT.controls.find(c => c.id === k).name} (${spec[units][3]})`);
    showValue(k);
  }
  $('windBearing').value = +P.wd.toFixed(1); $('bearingValue').value = +(route?.bearing ?? P.pb).toFixed(1);
  document.querySelectorAll('[data-units]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.units === units)));
}
function showValue(k) { $('v_' + k).textContent = SPEC[k][units][3]; }
function save() { LS.set('params', P); }
function parameterChanged() {
  save(); afterParams(); markCalc('updating'); schedule('all');
}
for (const k of Object.keys(SPEC)) {
  $(k).addEventListener('input', () => {
    P[k] = +$(k).value / factor(k); $('n_' + k).setCustomValidity(''); $('n_' + k).value = GP.display(k, P[k], units); showValue(k); parameterChanged();
  });
  $('n_' + k).addEventListener('change', () => {
    try {
      if (!$('n_' + k).value.trim()) throw new Error('Enter a number.');
      P[k] = GP.inputValue(k, Number($('n_' + k).value), units);
      $('n_' + k).setCustomValidity(''); $(k).value = P[k] * factor(k); parameterChanged();
    } catch (err) { $('n_' + k).setCustomValidity(err.message); $('n_' + k).reportValidity(); }
  });
  $('n_' + k).addEventListener('input', () => $('n_' + k).setCustomValidity(''));
}
$('curve').addEventListener('change', () => { P.curve = $('curve').checked; parameterChanged(); });
document.querySelectorAll('[data-units]').forEach(b => b.onclick = () => {
  units = b.dataset.units; U = G.Units[units]; LS.set('units', units);
  setSliders(); afterParams(); if (launch) placeStatus(); drawProfile(); if (route) refreshRoute();
  if (R) drawOverlay();
  if (map.hasLayer(contours)) contours.redraw();
  contourKey();
});

function afterParams() {
  $('wdDial').classList.toggle('calm', !P.ws);
  $('windWords').textContent = P.ws ? `From the ${compass(P.wd, true)}, blowing ${compass((P.wd + 180) % 360, true)}.` : 'Calm.';
  const kc = document.getElementById('keyCurve'); if (kc) kc.hidden = !P.curve;
  windBadge();
  soaringUI?.parameters();
  windUI?.parameters();
  summaries();
  updatePlanState();
  $('settingsSummary').textContent = `${P.gr}:1 · ${U.h(P.agl)} · ${P.ws ? `${U.v(P.ws)} from ${compass(P.wd)}` : 'calm'}`;
  $('windBearing').value = +P.wd.toFixed(1); $('bearingValue').value = +(route?.bearing ?? P.pb).toFixed(1);
}
// a folded section says what it's set to, so the panel can stay short
function summaries() {
  $('descentNote').textContent = `${CONTENT.trajectory.sinkNote} ${U.v(Math.max(G.steadyGlide(P.va,P.gr).sink, Math.min(P.dsink,P.va*.8)))}`;
  $('sumGlider').textContent = `${P.gr}:1, ${U.v(P.va)}, ${U.h(P.agl)} up`;
  $('sumWind').textContent = P.ws ? `${U.v(P.ws)} from ${compass(P.wd)}` : 'calm';
  $('sumRules').textContent = `seen to ${U.d(P.vis)}, ${U.h(P.mg)} clear, ${P.sl}° max`;
  $('sumLaunch').textContent = typeof groundAtLaunch === 'number' && groundAtLaunch === groundAtLaunch ? `ground ${U.h(groundAtLaunch)}` : '';
  const n = areas().length; $('sumOffline').textContent = n ? `${n} saved` : '';
}
// which sections are open is kept between visits
const openSecs = LS.get('open', {});
document.querySelectorAll('details.group').forEach(d => {
  const k = d.dataset.sec; if (k in openSecs) d.open = openSecs[k];
  d.addEventListener('toggle', () => { openSecs[k] = d.open; LS.set('open', openSecs); });
});
// The wind badge follows the map orientation and names the direction it comes from.
function windBadge() {
  const box=document.getElementById('windMap');if(!box)return;
  const local=windUI?.layer&&launch?windUI.atLatLng(launch):null,speed=local?Math.hypot(local.east,local.north):P.ws,from=local?WindCore.bearing(local.east,local.north):P.wd;
  box.classList.toggle('calm',speed<.05);box.querySelector('.wind-arrow').style.transform=`rotate(${GP.wrap(from+180-mapHeading)}deg)`;
  box.querySelector('.wind-text').innerHTML=(speed>=.05?`<b>${U.v(speed)}</b> from ${compass(from)}`:'<b>Calm</b>')+`<small>${local?`${U.h(windUI.height)} AGL`:'10 m reference'}</small>`;
  box.setAttribute('aria-label',`Wind at ${local?U.h(windUI.height)+' above ground':'10 metre reference'}: ${U.v(speed)} from ${compass(from,true)}`);
}

// ---------- Terrain tiles: one decoder for the calculation and the shaded map ----------
const tileMem = new Map(); // url -> Promise<Float32Array>, a small LRU
const TERRAIN_TIMEOUT = 12000; // One stalled tile must not hold the whole mosaic in Loading.
const decodeCanvas = document.createElement('canvas'); decodeCanvas.width = decodeCanvas.height = TS;
const decodeCtx = decodeCanvas.getContext('2d', { willReadFrequently: true });
function loadTerrTile(url) {
  if (tileMem.has(url)) { const p = tileMem.get(url); tileMem.delete(url); tileMem.set(url, p); return p; }
  const controller = new AbortController();
  let timer;
  const request = (async () => {
    const r = await fetch(url, { mode: 'cors', signal: controller.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const bmp = await createImageBitmap(await r.blob());
    decodeCtx.drawImage(bmp, 0, 0); bmp.close();
    const d = decodeCtx.getImageData(0, 0, TS, TS).data, out = new Float32Array(TS * TS);
    for (let i = 0, k = 0; i < out.length; i++, k += 4) out[i] = G.decodeTerrarium(d[k], d[k + 1], d[k + 2]);
    return out;
  })();
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error(CONTENT.calculation.timeout)); }, TERRAIN_TIMEOUT);
  });
  // Bound the response body and decoding too, including a network layer that fails to honour abort.
  const p = Promise.race([request, deadline]).finally(() => clearTimeout(timer));
  p.catch(() => { if (tileMem.get(url) === p) tileMem.delete(url); });
  tileMem.set(url, p);
  if (tileMem.size > 200) tileMem.delete(tileMem.keys().next().value);
  return p;
}

async function loadMosaic(lat, lon, z, onProgress, radius = RT) {
  const [px, py] = G.lonLatToPx(lon, lat, z);
  const tx = Math.floor(px / TS), ty = Math.floor(py / TS), W = (2 * radius + 1) * TS;
  const data = new Float32Array(W * W).fill(NaN);
  let done = 0, failed = 0; const jobs = [];
  for (let j = -radius; j <= radius; j++) for (let i = -radius; i <= radius; i++) {
    jobs.push(loadTerrTile(terrUrl(z, tx + i, ty + j)).then(t => {
      const ox = (i + radius) * TS, oy = (j + radius) * TS;
      for (let y = 0; y < TS; y++) data.set(t.subarray(y * TS, y * TS + TS), (oy + y) * W + ox);
    }).catch(() => { failed++; }).finally(() => onProgress(++done, jobs.length)));
  }
  await Promise.all(jobs);
  let minT = Infinity; for (const v of data) if (v < minT) minT = v;
  return { z, x0: (tx - radius) * TS, y0: (ty - radius) * TS, W, data, failed, total: jobs.length, minT, mpp: G.mppAt(lat, z) };
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

// ---------- Contour lines, from the same tiles, over any base map (offline too) ----------
// Terrain heights at zoom z over global pixels [x0, x0 + w) × [y0, y0 + h); NaN where a tile is missing.
async function terrWindow(z, x0, y0, w, h) {
  const out = new Float32Array(w * h).fill(NaN), n = 2 ** z, jobs = [];
  for (let ty = Math.floor(y0 / TS); ty <= Math.floor((y0 + h - 1) / TS); ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = Math.floor(x0 / TS); tx <= Math.floor((x0 + w - 1) / TS); tx++) {
      jobs.push(loadTerrTile(terrUrl(z, ((tx % n) + n) % n, ty)).then(e => {
        const xa = Math.max(x0, tx * TS), xb = Math.min(x0 + w, (tx + 1) * TS), ya = Math.max(y0, ty * TS), yb = Math.min(y0 + h, (ty + 1) * TS);
        for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) out[(y - y0) * w + x - x0] = e[(y - ty * TS) * TS + x - tx * TS];
      }, () => {}));
    }
  }
  await Promise.all(jobs);
  return out;
}
// Light lines with a dark edge over imagery; brown, like a printed map, over the light maps.
const contourStyle = () => base === sat ? { line: 'rgba(255,255,255,.8)', halo: 'rgba(0,0,0,.4)', w: [1, 1.8] }
                                       : { line: 'rgba(122,82,40,.6)', halo: null, w: [0.8, 1.6] };
const Contours = L.GridLayer.extend({
  createTile(c, done) {
    const dpr = Math.min(2, window.devicePixelRatio || 1), tile = document.createElement('canvas');
    tile.width = tile.height = TS * dpr;
    // above zoom 13 there is no finer terrain: contour the part of the zoom-13 tile under this one, drawn at full sharpness
    const zt = Math.min(c.z, Z_MAX), s = 2 ** (c.z - zt), span = TS / s, w = span + 4;
    const x0 = c.x * span - 2, y0 = c.y * span - 2, [step, every] = G.contourStep(c.z, units);
    terrWindow(zt, x0, y0, w, w).then(g => {
      const { minor, major } = G.contours(g, w, w, step, every), ctx = tile.getContext('2d'), st = contourStyle(), k = s * dpr;
      const X = v => (v - 1.5) * k; // grid index i is the centre of terrain pixel x0 + i: i − 2 + ½ pixels from the tile's corner
      const stroke = (arr, colour, width) => {
        if (!arr.length) return;
        ctx.beginPath();
        for (let i = 0; i < arr.length; i += 4) { ctx.moveTo(X(arr[i]), X(arr[i + 1])); ctx.lineTo(X(arr[i + 2]), X(arr[i + 3])); }
        ctx.strokeStyle = colour; ctx.lineWidth = width * dpr; ctx.stroke();
      };
      ctx.lineCap = ctx.lineJoin = 'round';
      if (st.halo) { stroke(minor, st.halo, st.w[0] + 1.5); stroke(major, st.halo, st.w[1] + 1.5); }
      stroke(minor, st.line, st.w[0]); stroke(major, st.line, st.w[1]);
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
const start = sharedPlan?.launch || LS.get('launch', null) || M_HILL;
let mapMode = 'inspect', pendingLaunch = null, placingLaunch = false;
const launchHistory = [];
const map = L.map('map', { zoomControl: true }).setView([start.lat, start.lon], 13);
const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' });
const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)' });
const shade = new Hillshade({ minNativeZoom: Z_MIN, maxNativeZoom: Z_MAX, minZoom: 8, maxZoom: 18, attribution: 'Terrain: AWS Terrain Tiles' });
// imagery shows what the ground is (a field, a forest, water), which the slope alone can't; online only, never stored
const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Powered by Esri | Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community' });
const contours = new Contours({ minZoom: 10, maxZoom: 19, zIndex: 5, attribution: 'Terrain: AWS Terrain Tiles' }); // same text as the hillshade's, so Leaflet shows it once
const BASES = { street: osm, topo, sat, shade };
const baseName = l => Object.keys(BASES).find(k => BASES[k] === l);
let base = navigator.onLine ? (BASES[LS.get('base', 'street')] || osm) : shade;
base.addTo(map);
if (LS.get('contours', base === sat)) contours.addTo(map);
map.on('baselayerchange', e => {
  base = e.layer;
  if (navigator.onLine) LS.set('base', baseName(base)); // going offline swaps to the hillshade; that isn't a choice to keep
  // contours come on with the imagery the first time, until the visitor says otherwise
  if (base === sat && LS.get('contours', null) === null) contours.addTo(map);
  if (map.hasLayer(contours)) contours.redraw();
  restyle();
  drawOverlay();
  drawProfile();
  mark3d('reach');
});
map.on('overlayadd overlayremove', e => { if (e.layer === contours) { LS.set('contours', e.type === 'overlayadd'); contourKey(); } });
map.on('zoomend', () => contourKey());
map.on('moveend resize', () => { if (!is3d) windUI?.render(); });
L.control.layers({ 'Street map (online)': osm, 'Topo map (online)': topo, 'Satellite (online)': sat, 'Shaded terrain (works offline)': shade },
  { 'Contour lines': contours }, { position: 'topright' }).addTo(map);
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
  const ul = L.DomUtil.create('div', 'legend-content', box);
  ul.innerHTML = '<ul class="legend"><li><span class="key k-straight"></span>Potential landing, straight</li>' +
    `<li><span class="key k-ds">1</span>${CONTENT.soaring.key}</li>` +
    '<li id="keyCurve"><span class="key k-curve"></span>Potential landing, curving</li>' +
    '<li><span class="key k-steep"></span>Reachable, too steep to land</li>' +
    `<li>${CONTENT.trajectory.legend}</li>` +
    '</ul><details class="legend-extra"><summary>Other map symbols</summary><ul class="legend"><li><span class="key k-out"></span>Reachable, but out of sight</li>' +
    '<li><span class="key k-ring"></span>As far as you can see it</li>' +
    '<li><span class="key k-hit"></span>Straight glide hits a slope</li>' +
    '<li><span class="key k-line"></span>Cross-section (dots: its distance marks)</li>' +
    `<li><span class="key k-route"></span>${CONTENT.trajectory.routeKey}</li>` +
    '<li id="keyContour" hidden><span class="key k-contour"></span><span></span></li></ul></details>';
  L.DomEvent.disableClickPropagation(box);
  return box;
} });
new Legend().addTo(map);
// the Key says how far apart the contour lines are at this zoom
function contourKey() {
  const li = document.getElementById('keyContour'); if (!li) return;
  const z = map.getZoom(), on = map.hasLayer(contours) && z >= 10;
  li.hidden = !on; if (!on) return;
  const [step, every] = G.contourStep(z, units);
  li.lastChild.textContent = `Contours every ${U.h(step)} (thick: ${U.h(step * every)})`;
}
contourKey();
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
// the colours follow the base map: dark lines on white casings over the light maps, light lines on dark casings over imagery
function restyle() {
  C = base === sat ? PAL.img : PAL.light;
  outline.setStyle({ color: C.line, opacity: base === sat ? .7 : .45 });
  hitLines.setStyle({ color: C.hit });
  ring.setStyle({ color: C.ring });
  profCase.setStyle({ color: C.casing }); routeCase.setStyle({ color: C.casing });
  profPast.setStyle({ color: C.line }); profLine.setStyle({ color: C.flight });
  probe.setStyle({ color: C.casing, fillColor: C.line });
  routeLine.setStyle({ color: C.route }); routeEnd.setStyle({ color: C.casing, fillColor: C.route });
  profTicks.eachLayer(t => t.setStyle({ color: C.line, fillColor: C.casing }));
  const key = document.querySelector('.legend-box'); if (key) key.classList.toggle('on-img', base === sat);
}
restyle();
const areaBoxes = L.layerGroup().addTo(map);
const marker = L.marker([start.lat, start.lon], { draggable: true, title: 'Launch (drag to move)', alt: 'Launch', icon: L.divIcon({ className: 'launch-pin', html: '<span>L</span>', iconSize: [40, 40], iconAnchor: [20, 20] }) }).addTo(map);
marker.on('dragend', () => setLaunch(marker.getLatLng().lat, marker.getLatLng().lng));
let suppressTap = 0;
function setMapMode(mode) {
  mapMode = mode; $('app').dataset.mapMode = mode;
  $('modeLaunch').setAttribute('aria-pressed', String(mode === 'launch'));
  $('modeInspect').setAttribute('aria-pressed', String(mode === 'inspect'));
}
function mapTap(lat, lon) {
  if (Date.now() - suppressTap < 700) return;
  if (mapMode === 'launch') {
    setLaunch(lat, lon); setMapMode('inspect');
    if (guideAfterTap) { guideAfterTap = false; openGuide(1); }
  } else showRoute(L.latLng(lat, lon));
}
map.on('click', e => {
  if (Date.now() - suppressTap < 700) return;
  mapTap(e.latlng.lat, e.latlng.lng);
});
$('modeLaunch').onclick = () => setMapMode('launch');
$('modeInspect').onclick = () => setMapMode('inspect');
$('undoLaunch').onclick = () => {
  const previous = launchHistory.pop(); if (!previous) return;
  setLaunch(previous.lat, previous.lon, 0, { history: false }); updateLaunchUndo();
};
function updateLaunchUndo() {
  $('undoLaunch').disabled = !launchHistory.length;
  $('mapTools').classList.toggle('has-history', launchHistory.length > 0);
}
setMapMode('inspect');

let lastRouteAt = 0;
const routeAt = ll => { if (Date.now() - lastRouteAt < 800) return; lastRouteAt = Date.now(); showRoute(ll); };
map.on('contextmenu', e => routeAt(e.latlng));
(() => { // long-press on a touch screen: hold still for half a second (same on iOS and Android)
  const el = map.getContainer(); let t = null, x0 = 0, y0 = 0;
  const cancel = () => { clearTimeout(t); t = null; };
  el.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || e.target.closest('.leaflet-control, .maplibregl-control-container, button')) return cancel();
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
    t = setTimeout(() => { t = null; const r = el.getBoundingClientRect(); suppressTap = Date.now(); routeAt(is3d ? view3d.unproject([x0-r.left,y0-r.top]) : map.containerPointToLatLng([x0-r.left,y0-r.top])); }, 550);
  }, { passive: true, capture: true });
  el.addEventListener('touchmove', e => { if (t && (!e.touches.length || Math.hypot(e.touches[0].clientX - x0, e.touches[0].clientY - y0) > 10)) cancel(); }, { passive: true, capture: true });
  el.addEventListener('touchend', cancel, true); el.addEventListener('touchcancel', cancel, true);
})();

// ---------- 3D: the same map tilted, with MapLibre GL, loaded the first time it is opened (glide-3d.js) ----------
// It sits inside the 2D map, over its tiles and under its controls, so the Key, the wind and the layers menu stay.
let view3d = null, is3d = false, loading3d = null, cameraRequest = 0;
const mark3d = what => { if (view3d && is3d) view3d.mark(what); };
const el3d = L.DomUtil.create('div', 'map3d', map.getContainer());
el3d.hidden = true;
el3d.setAttribute('role', 'application');
el3d.setAttribute('aria-label', 'Map. Drag to move; use heading controls to turn. Right-drag or two fingers to tilt. Tap to inspect a destination.');
// the 2D map underneath must not pan, zoom, set the launch or start a route from what happens in 3D
for (const t of ['mousedown', 'pointerdown', 'touchstart', 'click', 'dblclick', 'contextmenu', 'wheel', 'keydown']) el3d.addEventListener(t, e => e.stopPropagation());
const hint3d = L.DomUtil.create('div', 'hint3d', el3d);
hint3d.textContent = 'Drag to move · use the heading arrows to turn';
const hasWebGL = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } })();
const loadScript = src => new Promise((ok, fail) => {
  const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => fail(new Error(src)); document.head.appendChild(s);
});
function load3d() {
  if (!loading3d) loading3d = (async () => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'lib/maplibre/maplibre-gl.css'; document.head.appendChild(css);
    await loadScript('lib/maplibre/maplibre-gl.js');
    await loadScript('glide-3d.js');
    return Glide3D({
      lmap: map, el: el3d, pal: () => C, terrUrl: terrUrl('{z}', '{x}', '{y}'),
      L: { outline, hitLines, ring, profCase, profPast, profLine, profTicks, probe, routeCase, routeLine, routeEnd, marker },
      tiles: { street: osm._url, streetAttr: osm.options.attribution, topo: topo._url, topoAttr: topo.options.attribution,
               sat: sat._url, satAttr: sat.options.attribution },
      base: () => baseName(base), overlay: () => overlay, canvas: overlayCanvas, circle: G.circle,
      profile: () => soaringUI?.view === 'soaring' ? null : PROF, profileColour: () => profileColour(PROF),
      wind:()=>windUI?.features()||[], windShade:()=>windUI?.shade()||null,
      ridgeLabel: CONTENT.orientation.ridge, soaring: () => soaringUI?.features() || { key: '', items: [] }, onSoaring: index => soaringUI?.selectIndex(index),
      onViewport: () => { if (!view3d?.flying) windUI?.render(); }, onCamera: cameraChanged, onHover: point => mapHover(point, p => view3d.project(p)), onOut: () => { if (cursorFrom === 'map') hideCursor(); }, onInspect: routeAt, onTap: mapTap, onMoveLaunch: (lat, lon) => setLaunch(lat, lon)
    });
  })();
  loading3d.catch(() => { loading3d = null; });
  return loading3d;
}
// The existing MapLibre renderer also supplies a rotatable flat view. Leaflet remains the layer source.
function cameraChanged(bearing, pitch) {
  mapHeading = GP.wrap(bearing); mapPitch = pitch;
  const input = $('mapHeading');
  if (input && document.activeElement !== input) input.value = +mapHeading.toFixed(1);
  const north = $('mapNorth');
  if (north) north.querySelector('span').style.transform = `rotate(${-mapHeading}deg)`;
  if (btn3d) { btn3d.title = pitch > 1 ? 'Back to the flat map' : 'Tilt the map into 3D'; btn3d.textContent = pitch > 1 ? '2D' : '3D'; btn3d.setAttribute('aria-pressed', String(pitch > 1)); }
  windBadge();
}
async function set3d(on, pitch = 62, bearing = mapHeading, center = null, zoom = null) {
  const request = ++cameraRequest;
  if (on && !hasWebGL) { setStatus('<span class="warn">Map rotation needs WebGL in this browser.</span>'); return; }
  is3d = on;
  map.getContainer().classList.toggle('is-3d', on);
  LS.set('view3d', on && pitch > 1);
  if (!on) { if (view3d) view3d.close(); cameraChanged(0, 0); return; }
  if (!view3d) {
    setStatus('Loading the map…');
    try { view3d = await load3d(); } catch (e) {
      setStatus('<span class="warn">The map could not load. Check the connection and try again.</span>');
      return set3d(false);
    }
    if (launch) placeStatus();
  }
  if (!is3d || request !== cameraRequest) return;
  view3d.open({ bearing, pitch, center, zoom });
  cameraChanged(bearing, pitch);
}
function orientMap(bearing, center = null, zoom = null) {
  return set3d(true, mapPitch, GP.wrap(bearing), center, zoom);
}

let btn3d;
const Orientation = L.Control.extend({ options: { position: 'topleft' }, onAdd() {
  const box = L.DomUtil.create('div', 'map-orientation');
  box.innerHTML = `<div class="map-turn"><button type="button" id="mapLeft" aria-label="${CONTENT.orientation.left}">↶</button><label>${CONTENT.orientation.heading} <input id="mapHeading" type="number" min="0" max="359.9" step="1" value="0" aria-label="${CONTENT.orientation.hint}">°</label><button type="button" id="mapRight" aria-label="${CONTENT.orientation.right}">↷</button></div><div class="map-facing"><button type="button" id="mapNorth"><span aria-hidden="true">↑</span> ${CONTENT.orientation.north}</button><button type="button" class="view3d" id="mapTilt" aria-pressed="false">3D</button></div>`;
  L.DomEvent.disableClickPropagation(box); L.DomEvent.disableScrollPropagation(box);
  box.addEventListener('keydown', e => e.stopPropagation());
  return box;
} });
new Orientation().addTo(map);
btn3d = $('mapTilt'); btn3d.onclick = () => set3d(true, mapPitch > 1 ? 0 : 62);
$('mapLeft').onclick = () => orientMap(mapHeading - 15);
$('mapRight').onclick = () => orientMap(mapHeading + 15);
$('mapNorth').onclick = () => mapPitch > 1 ? orientMap(0) : set3d(false);
$('mapHeading').onchange = () => {
  const input = $('mapHeading'), value = Number(input.value);
  if (!input.value.trim() || !Number.isFinite(value)) { input.value = +mapHeading.toFixed(1); return; }
  input.value = GP.wrap(value); orientMap(value);
};


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
const wdDial = makeDial($('wdDial'), { mode: 'from', step: 5, get: () => P.wd, set: v => { P.wd = v; parameterChanged(); } });
const pbDial = makeDial($('pbDial'), { mode: 'to', step: 1, get: () => P.pb, set: v => { P.pb = v; save(); clearRoute(false); afterParams(); schedule('profile'); orientMap(v); } });

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
    if (e.data.screen) { soaringUI?.onMessage(e.data); return; }
    busy = false;
    if (!e.data.error && e.data.gridId === gridId) { Gres = { ...e.data, key: e.data.key||inflightKey }; onGrid(); }
    if (queued) { const q = queued; queued = null; if(q.key===runKey())send(q);else runGrid(); }
  };
  worker.onerror = () => { worker = null; busy = false; soaringUI?.workerFailed(); runGrid(); }; // e.g. opened from a file: run on the page instead
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
function runKey() { return [lpx, lpy, P.agl, P.mg, P.va, P.gr, P.ws, P.wd, P.vis, gridId, windUI?.revision||0].join(); }
function runGrid() {
  if (!P.curve || !GRID) { Gres = null; drawOverlay(); return; }
  const key = runKey();
  if (Gres && Gres.key === key && Gres.gridId === gridId) return;
  send({ key, cell: 2 * M.mpp, si: Math.floor((lpx - M.x0) / 2), sj: Math.floor((lpy - M.y0) / 2), h0: groundAtLaunch + P.agl,
         margin: P.mg, Va: P.va, GR: P.gr, windSpeed: P.ws, windFromDeg: P.wd, maxR: P.vis, wind:windUI?.layer||null });
}
function onGrid() {
  drawOverlay();
  if (!loading && Gres && Gres.key === runKey()) { if (route) refreshRoute(); drawProfile(); }
  checkZoom();
}

// ---------- Launch, terrain and the calculation ----------
async function useMosaic(lat, lon, z) {
  loading = true; markCalc('loading'); setStatus('Loading terrain…', 'terrain');
  try { M = await loadMosaic(lat, lon, z, (d, n) => { setStatus(`Loading terrain ${d} of ${n}…`, 'terrain'); markCalc('loading', `Terrain ${d}/${n}`); }); }
  finally { loading = false; }
  SL = slopeGrid(); GRID = poolGrid(); gridId++; Gres = null; GEO = null; postGrid();
  soaringUI?.terrain(M);
}

async function setLaunch(lat, lon, snapRadius = 0, options = {}) {
  try { GP.coordinates({ lat, lon }); } catch (err) { setStatus(err.message); return; }
  markCalc('loading');
  if (loading || placingLaunch) { pendingLaunch = [lat, lon, snapRadius, options]; return; }
  placingLaunch = true;
  const previous = launch && { lat: launch.lat, lon: launch.lng };
  const z = M ? M.z : Z_MAX;
  const far = () => {
    if (!M) return true;
    const [x, y] = G.lonLatToPx(lon, lat, M.z);
    return Math.abs(x - (M.x0 + M.W / 2)) > TS * 1.2 || Math.abs(y - (M.y0 + M.W / 2)) > TS * 1.2;
  };
  if (options.reload || far()) await useMosaic(lat, lon, z);
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
  fineGround = { lat, lon, h: await groundAt13(lat, lon).catch(() => NaN) };
  if (previous && options.history !== false && (Math.abs(previous.lat - lat) > 1e-9 || Math.abs(previous.lon - lon) > 1e-9)) { launchHistory.push(previous); if (launchHistory.length > 20) launchHistory.shift(); }
  const target = pendingTarget !== undefined ? pendingTarget : route?.target; pendingTarget = undefined;
  placeLaunch(lat, lon);
  if (target) { route = { target: L.latLng(target.lat, target.lon ?? target.lng) }; routeEnd.setLatLng(route.target).addTo(map); }
  updateLaunchUndo(); afterParams(); compute();
  if (route) refreshRoute();
  placingLaunch = false;
  if (pendingLaunch) { const next = pendingLaunch; pendingLaunch = null; await setLaunch(...next); }
}

// The ground at the launch always comes from zoom-13 terrain. A long glide works on coarser terrain, which smooths a
// peak tens of metres lower; reading the launch from that would lower the glider's start, shrink the reach and could
// send the zoom back again, so "Ground at the launch" (and the range) changed with nothing touched.
let fineGround = null;
async function groundAt13(lat, lon) {
  if (M && M.z === Z_MAX) { const [x, y] = G.lonLatToPx(lon, lat, M.z); return sample(x - M.x0, y - M.y0); }
  const [x, y] = G.lonLatToPx(lon, lat, Z_MAX), x0 = Math.floor(x - 0.5), y0 = Math.floor(y - 0.5), fx = x - 0.5 - x0, fy = y - 0.5 - y0;
  const g = await terrWindow(Z_MAX, x0, y0, 2, 2); // bilinear between pixel centres, as sample() does
  return g[0] * (1 - fx) * (1 - fy) + g[1] * fx * (1 - fy) + g[2] * (1 - fx) * fy + g[3] * fx * fy;
}

function placeLaunch(lat, lon) {
  launch = L.latLng(lat, lon);
  [lpx, lpy] = G.lonLatToPx(lon, lat, M.z);
  const fine = fineGround && fineGround.lat === lat && fineGround.lon === lon ? fineGround.h : NaN;
  groundAtLaunch = fine === fine ? fine : sample(lpx - M.x0, lpy - M.y0); // zoom 13 unless that tile is missing
  marker.setLatLng(launch);
  ring.setLatLng(launch);
  LS.set('launch', { lat, lon });
  $('launchLat').value = +lat.toFixed(6); $('launchLon').value = +lon.toFixed(6);
  GEO = null;
  clearRoute(false);
  placeStatus();
  mark3d();
}
function placeStatus() {
  if (groundAtLaunch !== groundAtLaunch) {
    markCalc('missing');
    setStatus(`<span class="warn">No terrain here. ${navigator.onLine ? 'It failed to download; try again.' : 'This spot is outside your saved areas.'}</span>`);
  } else if (M.failed) {
    setStatus(`<span class="warn">${M.failed} of ${M.total} terrain tiles are missing${navigator.onLine ? '' : ' (outside the saved area)'}, so the reach stops short there.</span>`);
  } else {
    setStatus(`Ground at the launch: ${U.h(groundAtLaunch)} above sea level.`);
  }
  summaries();
}

// A high launch over low ground can glide past the loaded block: pick the zoom whose block holds the whole glide.
// For one launch and one set of settings the terrain only ever gets coarser: going back to a finer zoom it has already
// left (the coarser block's lowest ground is a little different, or a tile keeps failing) could flip between two zooms
// for ever, redrawing the reach and the route each time with nothing changed.
let zoomTimer = null, zoomKey = null;
function checkZoom() {
  clearTimeout(zoomTimer);
  zoomTimer = setTimeout(async () => {
    if (!M || M.failed || loading || placingLaunch || groundAtLaunch !== groundAtLaunch) return;
    const lat = launch.lat;
    const range = Math.max(0, groundAtLaunch + P.agl - P.mg - M.minT) * P.gr * (P.va + Math.max(P.ws,windUI?.maxSpeed||0)) / P.va;
    let want = G.chooseZoom(range, lat, RT, Z_MAX, Z_MIN);
    const edge = (R && R.kind.some(k => k === 1)) || (Gres && Gres.edge);
    if (edge && want >= M.z && M.z > Z_MIN) want = M.z - 1; // lower ground just outside the block
    const key = [lat, launch.lng, P.agl, P.mg, P.va, P.gr, P.ws, P.wd, P.vis, P.curve,windUI?.scenarioKey||''].join();
    const same = key === zoomKey; zoomKey = key;
    if (want === M.z || (same && want > M.z)) return;
    await useMosaic(lat, launch.lng, want);
    const keep = route && route.target; // the route asked for (even while loading) stays, worked out again on the new terrain
    placeLaunch(lat, launch.lng);
    if (keep) { route = { target: keep }; routeEnd.setLatLng(keep).addTo(map); }
    compute();
    if (pendingLaunch) { const next = pendingLaunch; pendingLaunch = null; setLaunch(...next); }
  }, 350);
}

const elevAtENU = (e, n) => sample(lpx + e / M.mpp - M.x0, lpy - n / M.mpp - M.y0);
const pxLatLng = (x, y) => { const [lo, la] = G.pxToLonLat(x, y, M.z); return L.latLng(la, lo); };
const enuToLatLng = (e, n) => pxLatLng(lpx + e / M.mpp, lpy - n / M.mpp);
const cellLatLng = i => { const GW = GRID.GW; return pxLatLng(M.x0 + 2 * (i % GW) + 1, M.y0 + 2 * Math.floor(i / GW) + 1); };
const glideOpts = () => ({ n: 720, h0: groundAtLaunch + P.agl, margin: P.mg, Va: P.va, GR: P.gr, windSpeed: P.ws, windFromDeg: P.wd, wind:windUI?.layer||null,
                           ds: M.mpp / 2, maxD: M.W * M.mpp });

function compute() {
  if (!M || !launch || loading) return;
  if (groundAtLaunch !== groundAtLaunch) { clearResult(); soaringUI?.run(); return; }
  soaringUI?.run();
  if(windUI&&!windUI.prepare()){markCalc('updating',CONTENT.flow.updating);return;}
  const t0 = performance.now();
  R = G.castRays(glideOpts(), elevAtENU);
  R.h0 = groundAtLaunch + P.agl; R.key = runKey(); R.ms = performance.now() - t0;
  ring.setRadius(P.vis); if (!map.hasLayer(ring)) ring.addTo(map);
  mark3d();
  drawOverlay();
  drawProfile();
  runGrid();
  soaringUI?.run();
  if (route) refreshRoute();
  updatePlanState();
  checkZoom();
}

function clearResult() {
  R = null; Gres = null; markCalc('missing');
  outline.setLatLngs([]); hitLines.setLatLngs([]); clearTrace(); ring.remove(); routeCase.setLatLngs([]); routeLine.setLatLngs([]);
  if (route) refreshRoute();
  if (overlay) { map.removeLayer(overlay); overlay = null; }
  mark3d();
  $('stats').innerHTML = '';
  const c = $('profile'); c.getContext('2d').clearRect(0, 0, c.width, c.height);
  $('profWhat').textContent = '';
  $('btnFly').disabled = true;
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
  if (loading || R.key !== runKey() || (P.curve && (!Gres || Gres.key !== runKey() || Gres.gridId !== gridId))) { markCalc(loading ? 'loading' : 'updating'); return; }
  const t0 = performance.now();
  const GW = GRID.GW, mpp = M.mpp, cellA = (2 * mpp) ** 2 / 1e6, geo = geometry(), n = R.n, dmax = R.dmax, vis = P.vis, slMax = P.sl;
  const useG = Gres && Gres.gridId === gridId && P.curve, galt = useG ? Gres.alt : null, slope = GRID.slope;
  if (overlayCanvas.width !== GW) { overlayCanvas.width = overlayCanvas.height = GW; }
  const ctx = overlayCanvas.getContext('2d'), img = ctx.createImageData(GW, GW), px = img.data, A = C.a;
  // each cell's kind: 0 nothing, 1 out of sight, 2 too steep, 3 landable straight, 4 landable by curving
  const kind = new Uint8Array(GW * GW), curvedSteep = new Uint8Array(GW * GW);
  let landA = 0, curveLandA = 0, outA = 0;
  for (let i = 0; i < kind.length; i++) {
    const r0 = geo.ray[i], d = geo.dist[i];
    const straight = d <= Math.min(dmax[r0], dmax[r0 + 1 === n ? 0 : r0 + 1]);
    const curved = !straight && galt !== null && galt[i] > -Infinity;
    if (!straight && !curved) continue;
    if (d > vis) { kind[i] = 1; outA += cellA; } // reachable, but out of sight: the dashed ring marks where sight ends
    else if (slope[i] > slMax) { kind[i] = 2; curvedSteep[i] = curved ? 1 : 0; }
    else if (straight) { kind[i] = 3; landA += cellA; }
    else { kind[i] = 4; landA += cellA; curveLandA += cellA; }
  }
  // a landable cell on the border of its kind is drawn solid, so each landable region has a crisp outline (it reads on imagery)
  for (let gy = 0; gy < GW; gy++) for (let gx = 0; gx < GW; gx++) {
    const i = gy * GW + gx, t = kind[i];
    if (!t) continue;
    const edge = t >= 3 && ((gx > 0 && kind[i - 1] !== t) || (gx < GW - 1 && kind[i + 1] !== t) ||
                            (gy > 0 && kind[i - GW] !== t) || (gy < GW - 1 && kind[i + GW] !== t));
    const stripe = ((gx + gy) & 3) < 2;
    let c, a;
    if (t === 1) { c = C.out; a = A.out; }
    else if (t === 2) { c = C.steep; a = curvedSteep[i] && stripe ? A.steepStripe : A.steep; }
    else if (t === 3) { c = C.straight; a = edge ? A.edge : A.straight; }
    else { c = edge || !stripe ? C.curve : C.curveDark; a = edge ? A.edge : stripe ? A.curveStripe : A.curve; }
    const k = i * 4;
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
  mark3d('reach');
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
    ['Potential landing ground in sight', U.a(landA)],
  ];
  if (P.curve) rows.push(['Gained by curving round hills', useG ? `+${U.a(curveLandA)}` : 'working…']);
  if (outA > 0) rows.push(['Reachable but out of sight', U.a(outA)]);
  rows.push(['Directions where a slope stops the glide in sight', `${Math.round(100 * steepHits / n)}%`]);
  rows.push(['Terrain detail', `${U.h(mpp)} per point${M.z < Z_MAX ? ' (coarser, for a long glide)' : ''}`]);
  $('stats').innerHTML = rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
  hadResult = true; markCalc(M.failed ? 'partial' : 'ready');
  $('terrainDetail').textContent = `Terrain spacing ${U.h(M.mpp)}${M.failed ? ` · ${M.failed} missing tiles` : ''}`;
}

// ---------- Routes round terrain ----------
function showRoute(ll) {
  soaringUI?.setView('glide', false);
  route = { target: ll };
  refreshRoute(); updatePlanState();
}
function refreshRoute() {
  if (!route || !M || !GRID || !launch) return;
  const GW = GRID.GW, [x, y] = G.lonLatToPx(route.target.lng, route.target.lat, M.z);
  const gx = Math.floor((x - M.x0) / 2), gy = Math.floor((y - M.y0) / 2);
  const index = gx >= 0 && gy >= 0 && gx < GW && gy < GW ? gy * GW + gx : -1;
  const e = (x - lpx) * M.mpp, n = (lpy - y) * M.mpp, bearing = Math.atan2(e, n);
  const result = !loading && Gres?.gridId === gridId && Gres.key === runKey() ? Gres : null;
  const info = GP.inspect({ params: P, rays: !loading && R?.key === runKey() ? R : null, grid: { ...GRID, cell: 2 * M.mpp }, result, index,
    distance: Math.hypot(e, n), bearing, ground: index < 0 ? NaN : GRID.terr[index],
    slope: index < 0 ? NaN : GRID.slope[index], missing: M.failed > 0 });
  if (loading) { info.kind = 'pending'; info.reason = 'Loading terrain for this destination…'; info.cells = []; info.arrival = info.clearance = info.routeDistance = null; }
  if (!Number.isFinite(groundAtLaunch)) { info.kind = 'missing'; info.reason = 'Terrain is missing at the launch. Arrival and clearance cannot be calculated.'; info.cells = []; info.arrival = info.clearance = info.routeDistance = null; info.reachable = false; }
  if (!P.curve && info.reachable) {
    const p = G.glideAlong(glideOpts(), elevAtENU, bearing, 0);
    let min = Infinity;
    for (let k = 0; k <= p.end && p.d[k] <= info.distance; k++) min = Math.min(min, p.glide[k] - p.ground[k]);
    info.clearance = Math.min(min, info.arrival);
  }
  route.cells = info.cells; route.info = info; route.bearing = GP.wrap(bearing * 180 / Math.PI);
  const pts = info.cells.length ? info.cells.map(cellLatLng) : (!P.curve && info.reachable ? [launch, route.target] : []);
  routeCase.setLatLngs(pts); routeLine.setLatLngs(pts);
  routeEnd.setLatLng(route.target).addTo(map);
  $('destination').hidden = false;
  $('destination').classList.toggle('pending', info.kind === 'pending');
  $('destState').textContent = CONTENT.destination[info.kind];
  $('destCoords').textContent = `${route.target.lat.toFixed(5)}, ${route.target.lng.toFixed(5)}`;
  const value = (v, f) => Number.isFinite(v) ? f(v) : '—';
  const rows = [['Best-glide arrival AGL', value(info.arrival, U.h)], ['Route', value(info.routeDistance, U.d)],
    ['Min. terrain clearance', value(info.clearance, U.h)], ['Ground slope', value(info.slope, v => `${v.toFixed(1)}°`)],
    ['Sight', `${U.d(info.distance)} / ${U.d(P.vis)}`]];
  if(windUI?.ready){const v=windUI.atLatLng(route.target);rows.push([`Wind @ ${U.h(windUI.height)} AGL`,`${U.v(Math.hypot(v.east,v.north))} from ${compass(WindCore.bearing(v.east,v.north))}`]);}
  $('destStats').replaceChildren(...rows.map(([label, text]) => {
    const div = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = label; dd.textContent = text; div.append(dt, dd); return div;
  }));
  $('destReason').textContent = info.reason + (info.reachable && P.curve ? ' Route maximizes predicted arrival height on the terrain grid.' : '');
  $('profBack').hidden = false;
  $('prof').classList.add('has-route'); $('bearingValue').disabled = true; $('bearingValue').value = +route.bearing.toFixed(1);
  drawProfile(); map.invalidateSize();
}
function clearRoute(redraw) {
  route = null; routeCase.setLatLngs([]); routeLine.setLatLngs([]); routeEnd.remove();
  $('profBack').hidden = true; $('destination').hidden = true;
  $('prof').classList.remove('has-route'); $('bearingValue').disabled = false; $('bearingValue').value = +P.pb.toFixed(1);
  if (redraw) { updatePlanState(); drawProfile(); map.invalidateSize(); }
}
$('profBack').onclick = $('clearDestination').onclick = () => clearRoute(true);

// ---------- Cross-section ----------
let PROF = null; // what's drawn, for the touch / hover read-out
function rawProfileData() {
  if (route && route.cells && route.cells.length > 1 && Gres?.key === runKey()) {
    const GW=GRID.GW,cell=2*M.mpp,d=[],ground=[],glide=[],lls=[];
    let distance=0;
    route.cells.forEach((c,k)=>{
      const at=cellLatLng(c);
      if(k){const prev=route.cells[k-1],dx=c%GW-prev%GW,dy=Math.floor(c/GW)-Math.floor(prev/GW),len=Math.hypot(dx,dy)*cell,sx=Math.sign(dx),sy=Math.sign(dy);
        const mids=Math.abs(dx)===2?[[sx,0],[sx,sy]]:Math.abs(dy)===2?[[0,sy],[sx,sy]]:dx&&dy?[[sx,0],[0,sy]]:[];
        const h=Number.isFinite(Gres.midAlt?.[c])?Gres.midAlt[c]:(Gres.alt[prev]+Gres.alt[c])/2;
        const midGround=mids.length?Math.max(...mids.map(([mx,my])=>GRID.terr[prev+my*GW+mx])):(GRID.terr[prev]+GRID.terr[c])/2;
        const before=cellLatLng(prev);d.push(distance+len/2);ground.push(midGround);glide.push(h);lls.push(L.latLng((before.lat+at.lat)/2,(before.lng+at.lng)/2));distance+=len;
      }
      d.push(distance);ground.push(GRID.terr[c]);glide.push(Gres.alt[c]);lls.push(at);
    });
    const last=route.cells.at(-1),arrive=Gres.alt[last]-GRID.terr[last];
    return {d,ground,glide,end:d.length-1,hit:false,curve:true,lls,what:`Highest predicted arrival height: ${U.d(distance)} flown, arriving ${U.h(arrive)} above the ground.`};
  }
  const bearing = route?.bearing ?? P.pb, b = bearing * Math.PI / 180;
  const first = G.glideAlong(glideOpts(), elevAtENU, b, 0), dEnd0 = first.d[first.end] || 0;
  const targetDistance = route?.info?.distance;
  const span = Number.isFinite(targetDistance) ? Math.max(targetDistance * 1.15, 100) : Math.max(dEnd0 * 1.4, Math.min(P.vis * 1.1, M.W * M.mpp / 2), 800);
  const p = G.glideAlong(glideOpts(), elevAtENU, b, Math.max(0, span - dEnd0)); // the same glide, with the ground on past its end
  const dEnd = p.d[p.end] || 0;
  const d = [], ground = [], glide = [];
  for (let k = 0; k < p.d.length && p.d[k] <= span; k++) { d.push(p.d[k]); ground.push(p.ground[k]); glide.push(p.glide[k]); }
  const lls = d.map(s => enuToLatLng(Math.sin(b) * s, Math.cos(b) * s));
  const what = p.kind === 2 ? `Straight toward ${+bearing.toFixed(1)}°: the wind is too strong to fly this way.`
    : `Straight toward ${+bearing.toFixed(1)}° (${compass(bearing, true)}): ${p.kind === 0 ? 'meets the ground' : 'leaves the loaded terrain'} after ${U.d(dEnd)}` +
      (dEnd > P.vis ? `, but it's out of sight after ${U.d(P.vis)}.` : '.');
  let end = Math.min(p.end, d.length - 1), hit = p.kind === 0;
  if (route?.info?.reachable && !P.curve) {
    while (end > 0 && d[end] > targetDistance) end--;
    hit = false;
  }
  return { d, ground, glide, end, hit, curve: false, lls, what: route ? `${CONTENT.destination[route.info?.kind || 'pending']}: ${U.d(targetDistance || 0)} from launch.` : what };
}

// All views and playback consume this one sampled trajectory, including a selected approach.
function profileData() {
  const raw = rawProfileData();
  if (!route?.info?.reachable || raw.end < 1) {
    if(raw.end<1)return raw;
    const n=raw.end+1,d=raw.d.slice(0,n),ground=raw.ground.slice(0,n),best=raw.glide.slice(0,n),bearing=[],wind=[];
    for(let k=1;k<n;k++){
      const a=raw.lls[k-1],b=raw.lls[k],mid=L.latLng((a.lat+b.lat)/2,(a.lng+b.lng)/2);
      const [x,y]=G.lonLatToPx(mid.lng,mid.lat,M.z);
      bearing.push((route?.bearing??P.pb)*G.D2R);wind.push(windUI?.layer?WindCore.sampleLayer(windUI.layer,(x-lpx)*M.mpp,(lpy-y)*M.mpp):WindCore.vector(P.ws,P.wd));
    }
    const solved=G.descentPath({d,ground,best,bearing,wind,Va:P.va,GR:P.gr,margin:P.mg,maxSink:0});
    return {...raw,time:solved.time,sink:solved.sink,wind,bearing};
  }
  let points = raw.lls.slice(0, raw.end+1);
  if (raw.curve) { points[0]=launch; points[points.length-1]=route.target; }
  else { points=[launch,route.target]; }
  const lls=[points[0]],d=[0],ground=[groundAtLaunch],best=[R.h0],bearing=[],wind=[];
  const opts=glideOpts(), aero=G.steadyGlide(P.va,P.gr);
  const enu=ll=>{const [x,y]=G.lonLatToPx(ll.lng,ll.lat,M.z);return [(x-lpx)*M.mpp,(lpy-y)*M.mpp];};
  let blocked=false;
  for(let k=1;k<points.length;k++) {
    const a=enu(points[k-1]),b=enu(points[k]),length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    if(length<1e-6)continue;
    const count=Math.max(1,Math.ceil(length/Math.min(10,M.mpp/2))),brg=Math.atan2(b[0]-a[0],b[1]-a[1]);
    for(let j=1;j<=count;j++) {
      const f=j/count,e=a[0]+(b[0]-a[0])*f,n=a[1]+(b[1]-a[1])*f;
      const midE=e-(b[0]-a[0])/count/2,midN=n-(b[1]-a[1])/count/2;
      const v=opts.wind?WindCore.sampleLayer(opts.wind,midE,midN):WindCore.vector(P.ws,P.wd);
      const vg=G.groundSpeed(brg,aero.horizontal,Math.hypot(v.east,v.north),WindCore.bearing(v.east,v.north)*G.D2R);
      const ds=length/count,h=best.at(-1)-ds*aero.sink/vg,g=elevAtENU(e,n);
      bearing.push(brg);wind.push(v);d.push(d.at(-1)+ds);ground.push(g);best.push(h);lls.push(enuToLatLng(e,n));
      if(!(vg>0)||!Number.isFinite(g)||h<g+P.mg-0.02)blocked=true;
    }
  }
  const solved=G.descentPath({d,ground,best,bearing,wind,Va:P.va,GR:P.gr,margin:P.mg,maxSink:P.dsink});
  if(blocked||['blocked','missing','invalid'].includes(solved.state)) {
    return {...raw,end:0,what:CONTENT.trajectory.blocked,approach:'blocked'};
  }
  const state=P.dsink>0?solved.state:'disabled';
  return {d,ground,glide:solved.h,end:d.length-1,hit:false,curve:raw.curve,lls,time:solved.time,sink:solved.sink,wind,bearing,
    approach:state,what:CONTENT.trajectory[state]};
}
const profileColour = p => p?.curve || p?.approach ? C.route : C.flight;

function drawProfile() {
  if (soaringUI?.view === 'soaring') { soaringUI.drawProfile(); return; }
  const cv = $('profile');
  if (!R || !M) return;
  const p = profileData();
  $('profWhat').textContent = p.what;
  if(route?.info?.reachable) {
    let row=$('approachStats');
    if(!row){row=document.createElement('div');row.id='approachStats';const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=CONTENT.trajectory.arrival;row.append(dt,dd);$('destStats').append(row);}
    row.querySelector('dd').textContent=p.approach==='blocked'?CONTENT.trajectory.unavailable:U.h(p.glide[p.end]-p.ground[p.end]);
  }
  if ($('app').classList.contains('profile-off')) { PROF = { ...p }; drawTrace(p, []); $('btnFly').disabled = !(p.end > 0) || ['loading', 'updating', 'missing'].includes($('app').dataset.calc); return; }
  const dpr = window.devicePixelRatio || 1, Wc = cv.clientWidth, Hc = cv.clientHeight;
  if (!Wc || !Hc) return;
  if (cv.width !== Math.round(Wc * dpr) || cv.height !== Math.round(Hc * dpr)) { cv.width = Math.round(Wc * dpr); cv.height = Math.round(Hc * dpr); }
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, Wc, Hc);
  const series = profileColour(p);
  $('profKeyLine').style.borderTopColor = series; $('profKeyMargin').style.borderTopColor = series;
  if (p.d.length < 2) { PROF = null; clearTrace(); $('btnFly').disabled = true; return; }
  const dMax = p.d[p.d.length - 1];
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < p.d.length; k++) { if (Number.isFinite(p.ground[k])) { lo = Math.min(lo, p.ground[k]); hi = Math.max(hi, p.ground[k]); } if (Number.isFinite(p.glide[k])) hi = Math.max(hi, p.glide[k]); }
  if (!Number.isFinite(lo)) { PROF = null; clearTrace(); $('btnFly').disabled = true; $('profWhat').textContent = 'Terrain is missing along this cross-section.'; return; }
  hi = Math.max(hi, R.h0);
  const pad = (hi - lo) * 0.1 + 5; lo -= pad; hi += pad;
  const L0 = 52, B0 = 22, T0 = 8, R0 = 14, isMetric = units === 'metric', hk = isMetric ? 1 : G.FT;
  const X = d => L0 + (d / dMax) * (Wc - L0 - R0), Y = h => T0 + (1 - (h - lo) / (hi - lo)) * (Hc - T0 - B0);
  PROF = { ...p, X, Y, L0, R0, Wc, Hc, B0, T0, dMax };
  $('btnFly').disabled = !(p.end > 0 && p.glide[0] === p.glide[0]) || ['loading', 'updating', 'missing'].includes($('app').dataset.calc);

  // recessive grid: a few height lines (in the chosen unit) and distance ticks
  c.font = '12px system-ui, sans-serif'; c.fillStyle = COL.muted; c.strokeStyle = COL.line; c.lineWidth = 1;
  const hStep = niceStep((hi - lo) * hk / 3) / hk;
  c.textAlign = 'right'; c.textBaseline = 'middle';
  for (let h = Math.ceil(lo / hStep) * hStep; h <= hi; h += hStep) {
    c.beginPath(); c.moveTo(L0, Math.round(Y(h)) + .5); c.lineTo(Wc - R0, Math.round(Y(h)) + .5); c.stroke();
    c.fillText(U.h(h), L0 - 6, Y(h));
  }
  const dUnit = isMetric ? (dMax > 2500 ? 1000 : 1) : (dMax > 0.5 * G.MI ? G.MI : 1 / G.FT);
  const dStep = niceStep(dMax / dUnit / Math.max(1, Math.floor((Wc - L0 - R0) / 85))) * dUnit;
  c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  const dLabel = d => isMetric ? (dUnit === 1000 ? `${+(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`) : (dUnit === G.MI ? `${+(d / G.MI).toFixed(1)} mi` : `${Math.round(d * G.FT)} ft`);
  const ticks = [];
  for (let d = 0; d <= dMax + 1; d += dStep) { c.fillText(dLabel(d), X(d), Hc - 6); ticks.push(d); }

  // out of sight: shade the part of the strip beyond the sight distance
  if (!p.curve && P.vis < dMax) {
    c.fillStyle = COL.line; c.globalAlpha = 0.5; c.fillRect(X(P.vis), T0, Wc - R0 - X(P.vis), Hc - T0 - B0); c.globalAlpha = 1;
    c.fillStyle = COL.ink2; c.textAlign = 'left'; c.fillText('Out of sight', X(P.vis) + 6, T0 + 14);
  }
  // Ground is drawn in separate runs so missing terrain stays a gap.
  c.fillStyle = COL.terrain; c.strokeStyle = COL.terrainEdge; c.lineWidth = 1.5;
  let start = 0;
  while (start < p.d.length) {
    while (start < p.d.length && !Number.isFinite(p.ground[start])) start++;
    if (start === p.d.length) break;
    let end = start; c.beginPath(); c.moveTo(X(p.d[start]), Hc - B0);
    while (end < p.d.length && Number.isFinite(p.ground[end])) { c.lineTo(X(p.d[end]), Y(p.ground[end])); end++; }
    c.lineTo(X(p.d[end - 1]), Hc - B0); c.closePath(); c.fill(); c.stroke(); start = end;
  }
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
  mark3d();
}
// the point on the trace at distance s, between the profile's points
function llAt(p, s) {
  let k = 0; while (k < p.d.length - 2 && p.d[k + 1] < s) k++;
  const a = p.lls[k], b = p.lls[k + 1] || a, f = p.d[k + 1] > p.d[k] ? Math.min(1, Math.max(0, (s - p.d[k]) / (p.d[k + 1] - p.d[k]))) : 0;
  return L.latLng(a.lat + (b.lat - a.lat) * f, a.lng + (b.lng - a.lng) * f);
}
function drawTrace(p, ticks) {
  profTicks.clearLayers();
  const series=profileColour(p);
  profLine.setStyle({color:series}); routeLine.setStyle({color:C.route});
  if (p.curve) { routeCase.setLatLngs(p.lls); routeLine.setLatLngs(p.lls); profCase.setLatLngs([]); profLine.setLatLngs([]); profPast.setLatLngs([]); } // the route line is the trace
  else {
    const flown = p.lls.slice(0, p.end + 1);
    profCase.setLatLngs(p.lls); profLine.setLatLngs(flown); profPast.setLatLngs(p.lls.slice(p.end));
  }
  for (const s of ticks) if (s > 0) {
    L.circleMarker(llAt(p, s), { radius: 3.5, color: C.line, weight: 1.5, fillColor: C.casing, fillOpacity: 1, interactive: false }).addTo(profTicks);
  }
  mark3d();
}
let cursorK = null, cursorFrom = null; // where the cursor is (a profile point) and which graphic put it there
function showCursor(k, from) {
  if (!PROF || !PROF.img) return;
  cursorK = k; cursorFrom = from;
  const cv = $('profile'), c = cv.getContext('2d'), X = PROF.X(PROF.d[k]);
  c.putImageData(PROF.img, 0, 0);
  c.strokeStyle = COL.ink2; c.lineWidth = 1; c.beginPath(); c.moveTo(X + .5, PROF.T0); c.lineTo(X + .5, PROF.Hc - PROF.B0); c.stroke();
  const g = PROF.ground[k], v = PROF.glide[k], tip = $('profTip');
  tip.innerHTML = PROF.kind === 'soaring' ? soaringUI.tip(k) : `<b>${U.d(PROF.d[k])}</b> from launch<br>Ground MSL ${U.h(g)}` + (v === v && k <= PROF.end ? `<br>Glider AGL ${U.h(v - g)}<br>Clearance above margin ${U.h(v - g - P.mg)}` : '<br>Beyond predicted glide');
  tip.hidden = false;
  tip.style.left = Math.min(Math.max(4, X + 12), cv.clientWidth - tip.offsetWidth - 4) + 'px';
  tip.style.top = '10px';
  probe.setLatLng(PROF.lls[k]); if (!map.hasLayer(probe)) probe.addTo(map);
  mark3d();
  // scrubbing the cross-section past the edge of the map pans it just enough to keep the probe in view
  if (from === 'profile') {
    if (is3d) view3d.panInside(PROF.lls[k]);
    else map.panInside(PROF.lls[k], { padding: [36, 36], animate: false });
  }
}
function hideCursor() {
  cursorK = null; cursorFrom = null;
  $('profTip').hidden = true; probe.remove();
  mark3d();
  if (PROF && PROF.img) $('profile').getContext('2d').putImageData(PROF.img, 0, 0);
}
// on the cross-section: the cursor follows the pointer (or finger), and the probe shows the same spot on the map
function profHover(e) {
  if (!PROF?.X) return;
  const r = $('profile').getBoundingClientRect(), x = e.clientX - r.left;
  if (x < PROF.L0 || x > PROF.Wc - PROF.R0) { hideCursor(); return; }
  const dq = (x - PROF.L0) / (PROF.Wc - PROF.L0 - PROF.R0) * PROF.dMax;
  let k = 0; while (k < PROF.d.length - 1 && PROF.d[k + 1] < dq) k++;
  if (k < PROF.d.length - 1 && dq - PROF.d[k] > PROF.d[k + 1] - dq) k++;
  showCursor(k, 'profile');
}
$('profile').addEventListener('keydown', e => {
  if (!PROF?.img) return;
  const step = e.shiftKey ? 10 : 1;
  let next = cursorK ?? 0;
  if (e.key === 'ArrowRight') next += step;
  else if (e.key === 'ArrowLeft') next -= step;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = PROF.d.length - 1;
  else if (e.key === 'Escape') { hideCursor(); return; }
  else return;
  e.preventDefault(); showCursor(Math.max(0, Math.min(PROF.d.length - 1, next)), 'profile');
  $('cursorStatus').textContent = $('profTip').innerText.replace(/\n/g, '. ');
});
$('profile').addEventListener('pointermove', profHover);
$('profile').addEventListener('pointerdown', profHover);
$('profile').addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hideCursor(); });
// on the map: a pointer within a few pixels of the trace moves the cursor on the cross-section too
const NEAR_PX = 18;
function mapHover(point, project) {
  if (!PROF?.lls) return;
  let best = -1, bd = NEAR_PX * NEAR_PX;
  for (let k = 0; k < PROF.lls.length; k++) {
    const q = project(PROF.lls[k]), dx = q.x - point.x, dy = q.y - point.y;
    if (dx * dx + dy * dy < bd) { bd = dx * dx + dy * dy; best = k; }
  }
  if (best >= 0) showCursor(best, 'map');
  else if (cursorFrom === 'map') hideCursor();
}
map.on('mousemove', e => { if (!is3d) mapHover(e.containerPoint, p => map.latLngToContainerPoint(p)); });
map.on('mouseout', () => { if (cursorFrom === 'map') hideCursor(); });

// ---------- Saved areas ----------
let cachedAreaKeys = new Set();
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
  let savedC, runtime;
  try { savedC = await caches.open(SAVED); runtime = await caches.open(RUNTIME); }
  catch { $('saveStatus').textContent = 'This browser could not open offline storage.'; $('btnSave').disabled = false; return; }
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
  if (failed) { $('saveStatus').textContent = `Incomplete: ${keys.length - failed}/${keys.length} tiles saved. Retry Save this area to fetch the missing tiles.`; }
  else {
    a.tiles = keys.length;
    if (!LS.set('areas', [a, ...areas()])) { $('saveStatus').textContent = 'Terrain downloaded, but the area list could not be saved. Free browser storage and retry.'; $('btnSave').disabled = false; return; }
    $('areaName').value = '';
    let persisted = false;
    try { persisted = await navigator.storage.persist(); } catch (e) {}
    $('saveStatus').textContent = `Saved "${a.name}" (${fmtMB(bytes)}).` +
      (persisted ? '' : ' The browser may clear it if space runs low; on iPhone, add this page to your Home Screen to keep it.');
  }
  $('btnSave').disabled = !navigator.onLine;
  await renderAreas();
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
  summaries();
  try { cachedAreaKeys = new Set((await (await caches.open(SAVED)).keys()).map(r => r.url)); } catch { cachedAreaKeys = new Set(); }
  ul.innerHTML = ''; areaBoxes.clearLayers();
  for (const a of list) {
    const li = document.createElement('li');
    li.innerHTML = `<div class="nm"></div><button class="btn" type="button" data-go>Go</button><button class="btn" type="button" data-del>Delete</button>`;
    li.querySelector('.nm').textContent = a.name;
    const sub = document.createElement('span'); sub.textContent = `${fmtMB(a.bytes || 0)}, saved ${fmtDate(a.date)}`; li.querySelector('.nm').appendChild(sub);
    const state = document.createElement('span'), keys = areaKeys(a), count = keys.filter(k => cachedAreaKeys.has(k)).length;
    state.className = 'area-state' + (count < keys.length ? ' area-incomplete' : '');
    state.textContent = `${count}/${keys.length} terrain tiles${count === keys.length ? ' · complete' : ' · incomplete, save again to repair'}`;
    li.querySelector('.nm').appendChild(state);
    li.querySelector('[data-go]').setAttribute('aria-label', `Go to ${a.name}`);
    li.querySelector('[data-del]').setAttribute('aria-label', `Delete ${a.name}`);
    li.querySelector('[data-go]').onclick = () => { fitNext = true; map.setView([a.lat, a.lon], 13); setLaunch(a.lat, a.lon); };
    li.querySelector('[data-del]').onclick = () => deleteArea(a.id);
    ul.appendChild(li);
    L.rectangle(areaBounds(a), { color: C.line, weight: 1, dashArray: '2 5', opacity: .6, fill: false, interactive: false }).addTo(areaBoxes);
  }
  if (!list.length) ul.innerHTML = '<li class="hint">No saved areas yet.</li>';
  updateCoverage();
  const savedBytes = list.reduce((s, a) => s + (a.bytes || 0), 0); // the browser's own figure can lag a fresh save
  try {
    const { usage, quota } = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    const used = Math.max(usage, savedBytes);
    $('meterBar').style.width = Math.min(100, 100 * used / quota).toFixed(2) + '%';
    $('storage').textContent = `Using ${fmtMB(used)} of about ${fmtMB(quota)} this browser allows.` + (persisted ? ' Kept until you delete it.' : '');
  } catch (e) { $('storage').textContent = savedBytes ? `Saved areas use ${fmtMB(savedBytes)}.` : ''; }
}

// Verify what is actually present, including the shell, rather than trusting a previous save's metadata.
function updateCoverage() {
  if (!launch) return;
  const keys = areaKeys({ lat: launch.lat, lon: launch.lng }), count = keys.filter(k => cachedAreaKeys.has(k)).length;
  $('offlineReady').textContent = `Current launch coverage: ${count}/${keys.length} required terrain tiles saved. ` +
    (count === keys.length ? 'Terrain complete; verify the page files before going offline.' : 'Save this area for full offline terrain coverage.');
}
async function verifyOffline() {
  const b = $('verifyAreas'); b.disabled = true; $('saveStatus').textContent = 'Checking saved terrain and page files…';
  await renderAreas();
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration?.active) throw new Error('The offline page is not installed yet. Wait for installation, then verify again.');
    const reply = await new Promise((resolve, reject) => {
      const channel = new MessageChannel(), timer = setTimeout(() => reject(new Error('The offline page did not respond. Reload online and verify again.')), 4000);
      channel.port1.onmessage = e => { clearTimeout(timer); channel.port1.close(); resolve(e.data); };
      registration.active.postMessage({ type: 'verify-shell' }, [channel.port2]);
    });
    const count = launch ? areaKeys({ lat: launch.lat, lon: launch.lng }).filter(k => cachedAreaKeys.has(k)).length : 0;
    $('saveStatus').textContent = `${reply.present}/${reply.total} page files verified; ${count}/277 terrain tiles at this launch. ` +
      (reply.present === reply.total && count === 277 ? 'Ready for offline planning at this launch.' : 'Incomplete: reload online for page files, or save this area for terrain.');
  } catch (err) { $('saveStatus').textContent = err.message; }
  finally { b.disabled = false; }
}
$('verifyAreas').onclick = verifyOffline;

// ---------- Buttons ----------
$('retryTerrain').onclick = async () => {
  const b = $('retryTerrain'); b.disabled = true;
  try { await setLaunch(launch?.lat ?? start.lat, launch?.lng ?? start.lon, 0, { reload: true, history: false }); }
  finally { b.disabled = false; }
};
$('btnSave').onclick = saveArea;
$('btnMHill').onclick = () => { fitNext = true; setLaunch(M_HILL.lat, M_HILL.lon, M_HILL.snap); };
let cityRequest=null,cityGeneration=0;
$('cityQuery').addEventListener('input',()=>{cityGeneration++;cityRequest?.abort();$('cityResults').replaceChildren();$('cityStatus').textContent='';});
$('citySearch').addEventListener('submit',async e=>{
  e.preventDefault();const query=$('cityQuery').value.trim(),generation=++cityGeneration;
  cityRequest?.abort();$('cityResults').replaceChildren();
  if(query.length<2){$('cityStatus').textContent=CONTENT.search.short;return;}
  const request=cityRequest=new AbortController(),deadline=setTimeout(()=>request.abort(),10000);
  $('cityStatus').textContent=CONTENT.search.loading;$('citySearch').setAttribute('aria-busy','true');
  try {
    const url=new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.search=new URLSearchParams({name:query,count:'8',language:'en',format:'json'});
    const response=await fetch(url,{signal:request.signal});if(!response.ok)throw Error('Search unavailable');
    const data=await response.json();if(generation!==cityGeneration)return;
    const results=(Array.isArray(data.results)?data.results:[]).filter(p=>typeof p.name==='string'&&Number.isFinite(p.latitude)&&Math.abs(p.latitude)<85.05112878&&Number.isFinite(p.longitude)&&Math.abs(p.longitude)<=180);
    $('cityStatus').textContent=results.length?'':CONTENT.search.empty;
    for(const place of results){
      const li=document.createElement('li'),button=document.createElement('button');button.type='button';
      button.textContent=[place.name,place.admin1,place.country].filter((v,i,a)=>v&&a.indexOf(v)===i).join(', ');
      button.onclick=async()=>{
        cityGeneration++;cityRequest?.abort();$('cityResults').replaceChildren();$('cityStatus').textContent=CONTENT.search.selected;
        const at=L.latLng(place.latitude,place.longitude);map.setView(at,12,{animate:false});
        if(is3d)await set3d(true,mapPitch,mapHeading,at,11);
      };li.append(button);$('cityResults').append(li);
    }
  } catch(err) {if(generation===cityGeneration)$('cityStatus').textContent=CONTENT.search.failed;}
  finally {clearTimeout(deadline);if(cityRequest===request)$('citySearch').setAttribute('aria-busy','false');}
});
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

// ---------- Hide the settings (wide screens): the map takes the whole window; a button on the map brings them back ----------
let panelBtn;
function setPanel(on) {
  $('app').classList.toggle('panel-off', !on);
  LS.set('panel', on);
  const label = on ? 'Hide the settings' : 'Show the settings';
  panelBtn.title = label; panelBtn.setAttribute('aria-label', label); panelBtn.setAttribute('aria-expanded', String(on));
  panelBtn.querySelector('.chev').setAttribute('d', on ? 'M15.5 9.5 13 12l2.5 2.5' : 'M13 9.5l2.5 2.5L13 14.5');
  map.invalidateSize(); if (view3d) view3d.resize(); schedule('profile');
}
const ShowPanel = L.Control.extend({ options: { position: 'topleft' }, onAdd() {
  const div = L.DomUtil.create('div', 'leaflet-bar show-panel-bar wide-only');
  panelBtn = L.DomUtil.create('a', 'show-panel', div);
  panelBtn.href = '#'; panelBtn.setAttribute('role', 'button');
  panelBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9.5 4.5v15"/><path class="chev" d="M15.5 9.5 13 12l2.5 2.5"/></svg>';
  L.DomEvent.disableClickPropagation(div);
  L.DomEvent.on(panelBtn, 'click', e => { L.DomEvent.preventDefault(e); setPanel($('app').classList.contains('panel-off')); });
  return div;
} });
const showPanelCtl = new ShowPanel().addTo(map);
{ const corner = showPanelCtl.getContainer().parentNode; corner.insertBefore(showPanelCtl.getContainer(), corner.firstChild); }
setPanel(LS.get('panel', true) !== false);

// ---------- Quick start: three steps, on a first visit (until switched off) and from the book in the header ----------
const GLIDERS = Object.fromEntries(CONTENT.aircraft.map(a => [a.id, GP.aircraft(a)]));
let gStep = 0, guideAfterTap = false;
function paintGuide() {
  for (const b of document.querySelectorAll('[data-glider]')) {
    const g = GLIDERS[b.dataset.glider];
    b.setAttribute('aria-checked', String(P.gr === g.gr && P.va === g.va && P.vis === g.vis));
    b.querySelector('span').textContent = `${g.gr}:1 at ${U.v(g.va)}, seen to ${U.d(g.vis)}`;
  }
  for (const b of document.querySelectorAll('[data-height]')) {
    b.setAttribute('aria-checked', String(P.agl === +b.dataset.height));
    b.querySelector('span').textContent = `about ${U.h(+b.dataset.height)}`;
  }
}
function guideStep(n) {
  gStep = n;
  document.querySelectorAll('#guide [data-step]').forEach(el => { el.hidden = +el.dataset.step !== n; });
  document.querySelectorAll('#guide .dots i').forEach((d, i) => d.classList.toggle('on', i <= n));
  $('guideBack').disabled = n === 0;
  $('guideNext').textContent = n === 2 ? 'Done' : 'Next';
  paintGuide();
}
function openGuide(n = 0) {
  $('guideShow').checked = LS.get('guide', true);
  guideStep(n);
  if (!$('guide').open) $('guide').showModal();
}
$('btnGuide').onclick = () => openGuide(0);
$('guideShow').onchange = () => LS.set('guide', $('guideShow').checked);
$('guideNext').onclick = () => { if (gStep >= 2) $('guide').close(); else guideStep(gStep + 1); };
$('guideBack').onclick = () => guideStep(Math.max(0, gStep - 1));
$('guide').querySelector('[data-close]').onclick = () => $('guide').close();
$('guide').addEventListener('click', e => { if (e.target === $('guide')) $('guide').close(); }); // a click on the backdrop
$('guide').querySelector('[data-g=geo]').onclick = () => { locate(); guideStep(1); };
$('guide').querySelector('[data-g=example]').onclick = () => { fitNext = true; setLaunch(M_HILL.lat, M_HILL.lon, M_HILL.snap); guideStep(1); };
$('guide').querySelector('[data-g=tap]').onclick = () => { guideAfterTap = true; setMapMode('launch'); $('guide').close(); setStatus('Tap the map where you launch.'); };
const applyPreset = vals => {
  Object.assign(P, vals); save(); setSliders(); afterParams(); markCalc('updating'); schedule('all'); paintGuide();
};
document.querySelectorAll('[data-glider]').forEach(b => { b.onclick = () => applyPreset(GLIDERS[b.dataset.glider]); });
document.querySelectorAll('[data-height]').forEach(b => { b.onclick = () => applyPreset({ agl: +b.dataset.height }); });

// ---------- Aircraft and reusable flight plans ----------
const storedList = key => { const value = LS.get(key, []); return Array.isArray(value) ? value : []; };
const plans = () => storedList('plans').filter(a => {
  try { GP.validatePlan(a.plan); return typeof a.id === 'string' && typeof a.name === 'string'; } catch { return false; }
});
const customAircraft = () => storedList('aircraft').filter(a => {
  try { GP.aircraft(a); return typeof a.id === 'string' && typeof a.name === 'string'; } catch { return false; }
});
const idFor = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function currentPlan() {
  return launch ? GP.validatePlan({ version: 1, launch, params: P, target: route?.target || pendingTarget, units, windModel:windUI?.snapshot() }) : null;
}
function renderPlans() {
  const select = $('savedPlan'), choice = select.value;
  select.replaceChildren(new Option('Choose a plan', ''), ...plans().map(a => new Option(a.name, a.id)));
  select.value = plans().some(a => a.id === choice) ? choice : '';
  $('loadPlan').disabled = $('deletePlan').disabled = !select.value;
}
function renderAircraft() {
  $('aircraftPreset').replaceChildren(new Option('Custom settings', ''),
    ...CONTENT.aircraft.map(a => new Option(a.name, a.id)), ...customAircraft().map(a => new Option(a.name, a.id)));
}
function updatePlanState() {
  const now = currentPlan(), changed = selectedPlan && now ? GP.differences(selectedPlan.plan.params, P) : [];
  const dirty = selectedPlan && !GP.samePlan(now, selectedPlan.plan);
  $('planChanged').textContent = selectedPlan ? `${selectedPlan.name}${dirty ? ' · changed' : ' · saved'}` : 'Unsaved plan';
  const base = selectedPlan?.plan.params;
  for (const k of Object.keys(SPEC)) $(k).closest('.row').classList.toggle('changed', !!base && changed.includes(k));
  if (selectedPlan) $('planStatus').textContent = dirty ? `${changed.length} setting${changed.length === 1 ? '' : 's'} changed${!GP.samePlan({ ...now, params: selectedPlan.plan.params }, selectedPlan.plan) ? '; launch, destination or wind model changed' : ''}. Save to update this plan.` : 'Matches the saved plan.';
  const aircraft = [...CONTENT.aircraft, ...customAircraft()].find(a => ['gr', 'va', 'vis', 'dsink'].every(k => Math.abs(P[k] - (a[k]??0)) < 1e-8));
  selectedAircraft = aircraft || null;
  $('aircraftPreset').value = aircraft?.id || '';
  $('deleteAircraft').disabled = !aircraft || !customAircraft().some(a => a.id === aircraft.id);
  $('sharePlan').disabled = !launch || loading;
  if (typeof updateCoverage === 'function') updateCoverage();
}
$('savedPlan').onchange = () => { $('loadPlan').disabled = $('deletePlan').disabled = !$('savedPlan').value; };
$('savePlan').onclick = () => {
  const plan = currentPlan(), name = $('planName').value.trim().slice(0, 80);
  if (!name || !plan) { $('planStatus').textContent = 'Enter a name and set a launch before saving.'; $('planName').focus(); return; }
  const all = plans(), previous = all.find(a => a.name === name), record = { id: previous?.id || idFor(), name, plan };
  if (!LS.set('plans', [record, ...all.filter(a => a.id !== record.id)])) { $('planStatus').textContent = 'Browser storage is full. This plan was not saved; copy its link instead.'; return; }
  selectedPlan = record; renderPlans(); $('savedPlan').value = record.id; $('savedPlan').onchange(); updatePlanState();
};
$('loadPlan').onclick = async () => {
  const record = plans().find(a => a.id === $('savedPlan').value); if (!record) return;
  selectedPlan = record; $('planName').value = record.name;
  const p = GP.validatePlan(record.plan);
  Object.assign(P, p.params); windUI?.restore(p.windModel); units = p.units; U = G.Units[units]; LS.set('units', units);
  $('curve').checked = P.curve; pendingTarget = p.target;
  save(); setSliders(); wdDial.render(); pbDial.render();
  fitNext = true; await setLaunch(p.launch.lat, p.launch.lon);
  afterParams();
};
$('deletePlan').onclick = () => {
  const id = $('savedPlan').value;
  LS.set('plans', plans().filter(a => a.id !== id));
  if (selectedPlan?.id === id) { selectedPlan = null; $('planName').value = ''; }
  renderPlans(); updatePlanState(); $('planStatus').textContent = 'Saved plan deleted. Current settings are still open.';
};
$('aircraftPreset').onchange = () => {
  const a = [...CONTENT.aircraft, ...customAircraft()].find(a => a.id === $('aircraftPreset').value);
  if (!a) return;
  $('aircraftName').value = customAircraft().some(x => x.id === a.id) ? a.name : '';
  applyPreset(GP.aircraft(a)); wdDial.render();
  $('aircraftStatus').textContent = 'Aircraft sets glide ratio, airspeed, descent sink and sight distance. Launch height and wind stay as set.';
};
$('saveAircraft').onclick = () => {
  const name = $('aircraftName').value.trim().slice(0, 80);
  if (!name) { $('aircraftStatus').textContent = 'Enter an aircraft name.'; $('aircraftName').focus(); return; }
  const all = customAircraft(), a = { id: all.find(x => x.name === name)?.id || 'custom-' + idFor(), name, ...GP.aircraft(P) };
  if (!LS.set('aircraft', [a, ...all.filter(x => x.id !== a.id)])) { $('aircraftStatus').textContent = 'Browser storage is full; aircraft was not saved.'; return; }
  renderAircraft(); updatePlanState(); $('aircraftStatus').textContent = `Saved ${name}.`;
};
$('deleteAircraft').onclick = () => {
  LS.set('aircraft', customAircraft().filter(a => a.id !== selectedAircraft?.id));
  renderAircraft(); updatePlanState(); $('aircraftName').value = ''; $('aircraftStatus').textContent = 'Aircraft preset deleted. Current values are still open.';
};
$('sharePlan').onclick = async () => {
  const plan = currentPlan(); if (!plan) return;
  const url = new URL(location.href); url.hash = 'plan=' + GP.encode(plan);
  try { await navigator.clipboard.writeText(url.href); $('planStatus').textContent = 'Plan link copied, including launch, settings and destination.'; $('sharePlan').textContent = 'Link copied'; setTimeout(() => { $('sharePlan').textContent = 'Copy plan link'; }, 3000); }
  catch {
    document.querySelector('[data-sec=plans]').open = true;
    if (compact.matches) setDrawer(true); else setPanel(true);
    $('shareLink').hidden = false; $('shareLink').value = url.href;
    $('shareLink').focus(); $('shareLink').select(); $('shareLink').scrollIntoView({ block: 'nearest' });
    $('planStatus').textContent = 'Copy the selected plan link.';
  }
};
$('setCoordinates').onclick = () => {
  const lat = $('launchLat'), lon = $('launchLon');
  if (!lat.value || !lon.value || !lat.reportValidity() || !lon.reportValidity()) return;
  try { const p = GP.coordinates({ lat: +lat.value, lon: +lon.value }); fitNext = true; setLaunch(p.lat, p.lon); }
  catch (err) { setStatus(err.message); }
};
function numericBearing(id, key, dial, isFlight) {
  $(id).addEventListener('input', () => $(id).setCustomValidity(''));
  $(id).addEventListener('change', () => {
    const el = $(id), v = Number(el.value);
    if (!el.value || !Number.isFinite(v)) { el.setCustomValidity('Enter a bearing in degrees.'); el.reportValidity(); return; }
    el.setCustomValidity(''); P[key] = GP.wrap(v); el.value = +P[key].toFixed(1); dial.render();
    if (isFlight) parameterChanged();
    else { clearRoute(false); save(); afterParams(); schedule('profile'); map.invalidateSize(); orientMap(P.pb); }
  });
}
numericBearing('windBearing', 'wd', wdDial, true);
numericBearing('bearingValue', 'pb', pbDial, false);

// The phone's drawer sits over part of the map; it never replaces the planning view.
const compact = matchMedia('(max-width: 820px), (max-height: 520px)');
function setDrawer(open) {
  $('app').classList.toggle('drawer-open', open);
  if (!open) $('app').classList.remove('drawer-full');
  $('settingsToggle').setAttribute('aria-expanded', String(open));
  $('panel').inert = compact.matches && !open;
  $('expandDrawer').textContent = 'Expand';
}
$('settingsToggle').onclick = () => setDrawer(!$('app').classList.contains('drawer-open'));
$('closeDrawer').onclick = () => { setDrawer(false); $('settingsToggle').focus(); };
$('expandDrawer').onclick = () => { const full = $('app').classList.toggle('drawer-full'); $('expandDrawer').textContent = full ? 'Reduce' : 'Expand'; };
function setProfile(open, persist = true) {
  $('app').classList.toggle('profile-off', !open);
  $('profileToggle').setAttribute('aria-expanded', String(open));
  $('profileToggle').querySelector('span').textContent = open ? '⌄' : '⌃';
  if (persist) LS.set('profile', open);
  map.invalidateSize(); drawProfile();
}
$('profileToggle').onclick = () => setProfile($('app').classList.contains('profile-off'));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('app').classList.contains('drawer-open')) { setDrawer(false); $('settingsToggle').focus(); } });
compact.addEventListener('change', () => { setDrawer(false); setProfile(LS.get('profile', !compact.matches), false); });
renderPlans(); renderAircraft();
setDrawer(false); setProfile(LS.get('profile', !compact.matches), false);
if (sharedPlan) { selectedPlan = { name: 'Shared plan', plan: sharedPlan }; $('planStatus').textContent = 'Opened a shared plan. Give it a name to keep it on this device.'; }
if (shareError) { document.querySelector('[data-sec=plans]').open = true; $('planStatus').textContent = shareError; if (compact.matches) setDrawer(true); }

// ---------- Fly it: the camera follows the glide (the straight one, or the route) in 3D ----------
async function flyIt() {
  const p = PROF;
  if (soaringUI?.view === 'soaring') return;
  if (!p || !(p.end > 0) || ['loading', 'updating', 'missing'].includes($('app').dataset.calc)) return;
  if (!is3d || mapPitch < 1) await set3d(true);
  if (!is3d || !view3d) return;
  const n = p.end + 1;
  view3d.fly({ lls: p.lls.slice(0, n), d: p.d.slice(0, n), h: p.glide.slice(0, n), g: p.ground.slice(0, n), U,
               time: p.time, wind: p.wind, sink: p.sink, Va: P.va, gr: P.gr, ws: P.ws, wd: P.wd },
             k => showCursor(k, 'fly'), () => hideCursor());
}
$('btnFly').onclick = flyIt;

setSliders();
pbDial.render();
setNet();
renderAreas();
const first = (!navigator.onLine && areas().length && !LS.get('launch', null)) ? areas()[0] : start;
fitNext = true;
setLaunch(first.lat, first.lon, first === M_HILL ? M_HILL.snap : 0);
if (LS.get('view3d', false)) set3d(true);
if (!sharedPlan && LS.get('guide', true)) openGuide(0);
