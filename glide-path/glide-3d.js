// Glide Path in 3D: the same map tilted, drawn by MapLibre GL (vendored in lib/maplibre/), loaded by glide-app.js the
// first time 3D is opened. The mountains are the same Terrarium tiles the reach is worked out on (to zoom 13), so the
// reach colours, drawn into the page's own canvas, lie exactly on the ground they describe. Everything else is read
// from the 2D map's layers on each change (`mark`), so the 2D map stays the one source of truth.
'use strict';
function Glide3D(env) {
  const { lmap, el, L: layers, terrUrl, tiles, onTap } = env;
  let C = env.pal(); // the colours in use: they follow the base map, as on the 2D map
  const ras = (urls, maxzoom, attribution) => ({ type: 'raster', tiles: urls, tileSize: 256, maxzoom, attribution });
  const dem = () => ({ type: 'raster-dem', tiles: [terrUrl], tileSize: 256, encoding: 'terrarium', maxzoom: 13, attribution: 'Terrain: AWS Terrain Tiles' });
  const empty = { type: 'FeatureCollection', features: [] };
  const is = k => ['==', ['get', 'k'], k];
  const line = (id, src, paint) => ({ id, type: 'line', source: src, filter: is(id), layout: { 'line-cap': 'round', 'line-join': 'round' }, paint });
  const style = {
    version: 8,
    sources: {
      street: ras([tiles.street], 19, tiles.streetAttr),
      topo: ras(['a', 'b', 'c'].map(s => tiles.topo.replace('{s}', s)), 17, tiles.topoAttr),
      sat: ras([tiles.sat], 19, tiles.satAttr),
      dem: dem(), shadeDem: dem(), // MapLibre wants the hillshade on a source of its own, not the terrain's
      lines: { type: 'geojson', data: empty }, points: { type: 'geojson', data: empty }
    },
    terrain: { source: 'dem', exaggeration: 1 },
    sky: { 'sky-color': '#7fb2e5', 'horizon-color': '#dfe8f1', 'fog-color': '#e6ecf1', 'sky-horizon-blend': 0.6,
           'horizon-fog-blend': 0.5, 'fog-ground-blend': 0.9, 'atmosphere-blend': 0 },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#eeeae0' } },
      { id: 'street', type: 'raster', source: 'street', layout: { visibility: 'none' } },
      { id: 'topo', type: 'raster', source: 'topo', layout: { visibility: 'none' } },
      { id: 'sat', type: 'raster', source: 'sat', layout: { visibility: 'none' } },
      // the light maps are flat pictures, so a hillshade over them shows the slopes; imagery has its own shadows
      { id: 'shade', type: 'hillshade', source: 'shadeDem', paint: { 'hillshade-shadow-color': '#4f4a3e', 'hillshade-highlight-color': '#ffffff',
        'hillshade-accent-color': '#6d6655', 'hillshade-illumination-direction': 315 } },
      line('outline', 'lines', { 'line-color': C.line, 'line-width': 1, 'line-opacity': 0.45 }),
      line('hit', 'lines', { 'line-color': C.hit, 'line-width': 4, 'line-opacity': 0.95 }),
      line('ring', 'lines', { 'line-color': C.ring, 'line-width': 2, 'line-dasharray': [4, 3] }),
      line('profCase', 'lines', { 'line-color': C.casing, 'line-width': 6, 'line-opacity': 0.85 }),
      line('profPast', 'lines', { 'line-color': C.line, 'line-width': 2, 'line-opacity': 0.85, 'line-dasharray': [3, 3] }),
      line('profLine', 'lines', { 'line-color': C.line, 'line-width': 3, 'line-opacity': 0.95 }),
      line('routeCase', 'lines', { 'line-color': C.casing, 'line-width': 7, 'line-opacity': 0.9 }),
      line('routeLine', 'lines', { 'line-color': C.route, 'line-width': 4 }),
      { id: 'ticks', type: 'circle', source: 'points', filter: is('tick'), paint: { 'circle-radius': 3.5, 'circle-color': C.casing,
        'circle-stroke-color': C.line, 'circle-stroke-width': 1.5, 'circle-pitch-alignment': 'map' } },
      { id: 'routeEnd', type: 'circle', source: 'points', filter: is('routeEnd'), paint: { 'circle-radius': 7, 'circle-color': C.route,
        'circle-stroke-color': C.casing, 'circle-stroke-width': 2 } },
      { id: 'probe', type: 'circle', source: 'points', filter: is('probe'), paint: { 'circle-radius': 8, 'circle-color': C.line,
        'circle-stroke-color': C.casing, 'circle-stroke-width': 3 } }
    ]
  };

  let m = null, ready = false, open = false, queued = false, reachDirty = true, lastLaunch = null, marker = null;
  const ll = a => [a.lng, a.lat];
  // a Leaflet polyline's points as one line, or several (hitLines holds pairs)
  function lineFeature(k, lls) {
    if (!lls || !lls.length) return null;
    if (Array.isArray(lls[0])) {
      const parts = lls.filter(p => p.length > 1).map(p => p.map(ll));
      return parts.length ? { type: 'Feature', properties: { k }, geometry: { type: 'MultiLineString', coordinates: parts } } : null;
    }
    return lls.length > 1 ? { type: 'Feature', properties: { k }, geometry: { type: 'LineString', coordinates: lls.map(ll) } } : null;
  }
  const point = (k, p) => ({ type: 'Feature', properties: { k }, geometry: { type: 'Point', coordinates: ll(p) } });

  function paintColours() {
    const set = (id, prop, v) => m.setPaintProperty(id, prop, v);
    set('outline', 'line-color', C.line); set('hit', 'line-color', C.hit); set('ring', 'line-color', C.ring);
    set('profCase', 'line-color', C.casing); set('profPast', 'line-color', C.line); set('profLine', 'line-color', C.line);
    set('routeCase', 'line-color', C.casing); set('routeLine', 'line-color', C.route);
    set('ticks', 'circle-color', C.casing); set('ticks', 'circle-stroke-color', C.line);
    set('routeEnd', 'circle-color', C.route); set('routeEnd', 'circle-stroke-color', C.casing);
    set('probe', 'circle-color', C.line); set('probe', 'circle-stroke-color', C.casing);
  }

  function sync() {
    queued = false;
    if (!open || !ready) return;
    if (env.pal() !== C) { C = env.pal(); paintColours(); }
    const on = l => lmap.hasLayer(l);
    // the base map: whatever the 2D layers menu says
    const base = env.base();
    for (const k of ['street', 'topo', 'sat']) m.setLayoutProperty(k, 'visibility', k === base ? 'visible' : 'none');
    m.setLayoutProperty('shade', 'visibility', base === 'sat' ? 'none' : 'visible');
    m.setPaintProperty('shade', 'hillshade-exaggeration', base === 'shade' ? 0.6 : 0.3);

    const lines = [];
    const add = f => { if (f) lines.push(f); };
    add(lineFeature('outline', layers.outline.getLatLngs()));
    add(lineFeature('hit', layers.hitLines.getLatLngs()));
    if (on(layers.ring)) {
      const c = layers.ring.getLatLng(), r = layers.ring.getRadius();
      add(lineFeature('ring', env.circle(c.lat, c.lng, r, 128).map(([lat, lng]) => ({ lat, lng }))));
    }
    for (const k of ['profCase', 'profPast', 'profLine', 'routeCase', 'routeLine']) add(lineFeature(k, layers[k].getLatLngs()));
    m.getSource('lines').setData({ type: 'FeatureCollection', features: lines });

    const pts = layers.profTicks.getLayers().map(t => point('tick', t.getLatLng()));
    if (on(layers.routeEnd)) pts.push(point('routeEnd', layers.routeEnd.getLatLng()));
    if (on(layers.probe)) pts.push(point('probe', layers.probe.getLatLng()));
    m.getSource('points').setData({ type: 'FeatureCollection', features: pts });

    // the launch: a pin you can drag, as on the 2D map; brought into view when it moves off screen
    const at = layers.marker.getLatLng();
    marker.setLngLat(ll(at));
    if (lastLaunch && !lastLaunch.equals(at)) {
      const p = m.project(ll(at)), w = m.getContainer().clientWidth, h = m.getContainer().clientHeight;
      if (p.x < 0 || p.y < 0 || p.x > w || p.y > h) m.easeTo({ center: ll(at), duration: 600 });
    }
    lastLaunch = at;

    // the reach: the 2D overlay's own canvas, placed by its corners
    const ov = env.overlay();
    if (!ov) { if (m.getLayer('reach')) m.setLayoutProperty('reach', 'visibility', 'none'); return; }
    const b = ov.getBounds(), corners = [[b.getWest(), b.getNorth()], [b.getEast(), b.getNorth()], [b.getEast(), b.getSouth()], [b.getWest(), b.getSouth()]];
    const src = m.getSource('reach');
    if (!src) {
      m.addSource('reach', { type: 'canvas', canvas: env.canvas, coordinates: corners, animate: false });
      m.addLayer({ id: 'reach', type: 'raster', source: 'reach', paint: { 'raster-fade-duration': 0 } }, 'outline');
    } else {
      m.setLayoutProperty('reach', 'visibility', 'visible');
      if (JSON.stringify(src.coordinates) !== JSON.stringify(corners)) src.setCoordinates(corners);
      if (reachDirty) { src.play(); m.once('render', () => src.pause()); } // copy the canvas once, then hold it
    }
    reachDirty = false;
  }

  function mark(what) {
    if (what === 'reach') reachDirty = true;
    if (open && !queued) { queued = true; requestAnimationFrame(sync); }
  }

  function create() {
    const c = lmap.getCenter();
    m = new maplibregl.Map({ container: el, style, center: [c.lng, c.lat], zoom: lmap.getZoom() - 1, pitch: 62, bearing: 0,
                             maxPitch: 80, attributionControl: { compact: true } });
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    marker = new maplibregl.Marker({ draggable: true, color: '#6459d3' }).setLngLat([c.lng, c.lat]).addTo(m);
    marker.on('dragend', () => { const p = marker.getLngLat(); onTap(p.lat, p.lng); });
    m.on('click', e => onTap(e.lngLat.lat, e.lngLat.lng));
    m.on('load', () => {
      ready = true; reachDirty = true; sync();
      // the credits start folded (the i button), so they don't run into the Key
      const a = el.querySelector('.maplibregl-ctrl-attrib'); if (a) a.classList.remove('maplibregl-compact-show');
    });
  }

  // ---------- Fly it: a chase camera behind and above the glider, along the glide's own heights ----------
  // path: { lls, d (m along it), h (glider, m above sea level), g (ground), U (read-outs) }. Time runs faster than real:
  // 8 to 40 s for the whole glide. The glider is drawn at the middle of the view, where the camera looks.
  let flight = null;
  const BACK = 150, UP = 55; // metres behind and above the glider
  function at(path, s) {
    const d = path.d; let k = 0;
    while (k < d.length - 2 && d[k + 1] < s) k++;
    const f = d[k + 1] > d[k] ? Math.min(1, Math.max(0, (s - d[k]) / (d[k + 1] - d[k]))) : 0, a = path.lls[k], b = path.lls[k + 1] || a;
    const lerp = (x, y) => x + (y - x) * f;
    return { k: f > 0.5 ? k + 1 : k, lat: lerp(a.lat, b.lat), lng: lerp(a.lng, b.lng), h: lerp(path.h[k], path.h[k + 1] ?? path.h[k]),
             g: lerp(path.g[k], path.g[k + 1] ?? path.g[k]) };
  }
  function hud(html, buttons) {
    let box = el.querySelector('.fly-hud');
    if (!box) { box = document.createElement('div'); box.className = 'fly-hud'; box.setAttribute('role', 'status'); el.appendChild(box); }
    box.innerHTML = `<span>${html}</span>`;
    for (const [label, fn] of buttons) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.onclick = fn; box.appendChild(b); }
    return box;
  }
  function gliderIcon(on) {
    let g = el.querySelector('.fly-glider');
    if (!g && on) {
      g = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      g.setAttribute('class', 'fly-glider'); g.setAttribute('viewBox', '0 0 120 36'); g.setAttribute('aria-hidden', 'true');
      // a sailplane seen from behind: long thin wings, a slim fuselage and a T-tail
      g.innerHTML = '<g fill="#fff" stroke="#1d1e23" stroke-width="1.5" stroke-linejoin="round">' +
        '<path d="M2 21 L58 17 L62 17 L118 21 L118 23 L62 21 L58 21 L2 23 Z"/><ellipse cx="60" cy="20" rx="4.5" ry="5"/>' +
        '<path d="M58.5 15 L59 5 L61 5 L61.5 15 Z"/><path d="M48 6 L72 6 L72 8 L48 8 Z"/></g>';
      el.appendChild(g);
    }
    if (g) g.style.display = on ? '' : 'none';
  }
  function endFlight(keepHud) {
    if (!flight) return;
    cancelAnimationFrame(flight.raf);
    m.off('movestart', flight.grab);
    m.setCenterClampedToGround(true);
    gliderIcon(false);
    const done = flight.onEnd; flight = null;
    if (!keepHud) { const b = el.querySelector('.fly-hud'); if (b) b.remove(); }
    if (done) done();
  }
  function fly(path, onAt, onEnd) {
    if (!ready) { m.once('load', () => fly(path, onAt, onEnd)); return; }
    endFlight();
    const total = path.d[path.d.length - 1], dur = Math.min(40, Math.max(8, 6 + total / 250)) * 1000, U = path.U;
    const hint = el.querySelector('.hint3d'); if (hint) hint.classList.add('gone');
    // dragging or zooming the map yourself ends the flight
    const grab = e => { if (e.originalEvent) { endFlight(); } };
    flight = { raf: 0, grab, onEnd, t0: null };
    m.on('movestart', grab);
    m.setCenterClampedToGround(false); // the camera looks at the glider in the air, not at the ground under it
    gliderIcon(true);
    let ux = 0, uy = 1; // the way along the track, east and north
    const stop = () => endFlight();
    const frame = now => {
      if (!flight) return;
      if (flight.t0 === null) flight.t0 = now;
      const u = Math.min(1, (now - flight.t0) / dur), s = total * u, p = at(path, s), q = at(path, Math.min(total, s + 80));
      const cos = Math.cos(p.lat * Math.PI / 180), ex = (q.lng - p.lng) * cos, ny = q.lat - p.lat, len = Math.hypot(ex, ny);
      if (len > 1e-9) { ux = ex / len; uy = ny / len; }
      const mPerDeg = 111320, fromLat = p.lat - uy * BACK / mPerDeg, fromLng = p.lng - ux * BACK / (mPerDeg * cos);
      const ground = m.queryTerrainElevation([fromLng, fromLat]) || 0;
      const camAlt = Math.max(p.h + UP, ground + 25);
      m.jumpTo(m.calculateCameraOptionsFromTo([fromLng, fromLat], camAlt, [p.lng, p.lat], p.h));
      onAt(p.k);
      if (u < 1) {
        hud(`${U.d(s)} out, ${U.h(Math.max(0, p.h - p.g))} above the ground`, [['Stop', stop]]);
        flight.raf = requestAnimationFrame(frame);
      } else {
        endFlight(true);
        hud(`Down after ${U.d(total)}`, [['Fly again', () => fly(path, onAt, onEnd)], ['Done', () => { const b = el.querySelector('.fly-hud'); if (b) b.remove(); }]]);
      }
    };
    flight.raf = requestAnimationFrame(frame);
  }

  return {
    fly,
    open() {
      open = true; el.hidden = false;
      if (!m) create();
      else {
        const c = lmap.getCenter();
        m.resize(); m.jumpTo({ center: [c.lng, c.lat], zoom: lmap.getZoom() - 1 });
      }
      reachDirty = true; mark();
    },
    close() {
      endFlight();
      open = false;
      if (m) { const c = m.getCenter(); lmap.setView([c.lat, c.lng], Math.round(m.getZoom() + 1), { animate: false }); }
      el.hidden = true;
    },
    resize() { if (m && open) m.resize(); },
    mark
  };
}
