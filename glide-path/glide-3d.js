// Dyna-soar in 3D: the same map tilted, drawn by MapLibre GL (vendored in lib/maplibre/), loaded by glide-app.js the
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
      line('windCase','lines',{'line-color':C.casing,'line-width':5}),
      line('windLine','lines',{'line-color':C.line,'line-width':1.5}),
      line('dsCase', 'lines', { 'line-color': C.casing, 'line-width': 6 }),
      line('dsLine', 'lines', { 'line-color': C.line, 'line-width': 2, 'line-dasharray': [3, 3] }),
      { id: 'ticks', type: 'circle', source: 'points', filter: is('tick'), paint: { 'circle-radius': 3.5, 'circle-color': C.casing,
        'circle-stroke-color': C.line, 'circle-stroke-width': 1.5, 'circle-pitch-alignment': 'map' } },
      { id: 'routeEnd', type: 'circle', source: 'points', filter: is('routeEnd'), paint: { 'circle-radius': 7, 'circle-color': C.route,
        'circle-stroke-color': C.casing, 'circle-stroke-width': 2 } },
      { id: 'probe', type: 'circle', source: 'points', filter: is('probe'), paint: { 'circle-radius': 8, 'circle-color': C.line,
        'circle-stroke-color': C.casing, 'circle-stroke-width': 3 } }
    ]
  };

  let m = null, ready = false, open = false, queued = false, reachDirty = true, lastLaunch = null, marker = null;
  let dsMarkers = [], dsKey = null;
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
    set('windCase','line-color',C.casing);set('windLine','line-color',C.line);set('dsCase', 'line-color', C.casing); set('dsLine', 'line-color', C.line);
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
    add(lineFeature('windCase',env.wind?.()||[]));add(lineFeature('windLine',env.wind?.()||[]));
    const ds = env.soaring?.() || { key: '', items: [] };
    for (const c of ds.items) { add(lineFeature('dsCase', c.outline)); add(lineFeature('dsLine', c.outline)); }
    if (ds.key !== dsKey) {
      dsKey = ds.key; dsMarkers.forEach(pin => pin.remove()); dsMarkers = [];
      for (const c of ds.items) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'ds-pin ds-3d-pin' + (c.selected ? ' selected' : '');
        button.innerHTML = `<span>DS? ${c.index + 1}</span>`; button.setAttribute('aria-label', `Inspect candidate ridge ${c.index + 1}`);
        button.onclick = e => { e.stopPropagation(); env.onSoaring(c.index); };
        dsMarkers.push(new maplibregl.Marker({ element: button }).setLngLat(ll(c.point)).addTo(m));
      }
    }
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
    const wind=env.windShade?.();
    if(wind){const b=wind.bounds,coordinates=[[b.getWest(),b.getNorth()],[b.getEast(),b.getNorth()],[b.getEast(),b.getSouth()],[b.getWest(),b.getSouth()]];let source=m.getSource('airflow');
      if(!source){m.addSource('airflow',{type:'canvas',canvas:wind.canvas,coordinates,animate:false});m.addLayer({id:'airflow',type:'raster',source:'airflow',paint:{'raster-opacity':.65,'raster-fade-duration':0}},'outline');source=m.getSource('airflow');}
      else{source.setCoordinates(coordinates);m.setLayoutProperty('airflow','visibility','visible');}source.play();m.once('render',()=>source.pause());
    }else if(m.getLayer('airflow'))m.setLayoutProperty('airflow','visibility','none');
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
    marker.on('dragend', () => { const p = marker.getLngLat(); (env.onMoveLaunch || onTap)(p.lat, p.lng); });
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
  const BACK = 150, UP = 80; // metres behind and above the glider: about 28° down, enough to see the tops of the wings
  function at(path, s) {
    const d = path.d; let k = 0;
    while (k < d.length - 2 && d[k + 1] < s) k++;
    const f = d[k + 1] > d[k] ? Math.min(1, Math.max(0, (s - d[k]) / (d[k + 1] - d[k]))) : 0, a = path.lls[k], b = path.lls[k + 1] || a;
    const lerp = (x, y) => x + (y - x) * f;
    return { k: f > 0.5 ? k + 1 : k, lat: lerp(a.lat, b.lat), lng: lerp(a.lng, b.lng), h: lerp(path.h[k], path.h[k + 1] ?? path.h[k]),
             g: lerp(path.g[k], path.g[k + 1] ?? path.g[k]) };
  }
  // the track's direction (radians clockwise from north) at s, over ±half metres
  const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));
  function trackAt(path, s, half) {
    const total = path.d[path.d.length - 1], a = at(path, Math.max(0, s - half)), b = at(path, Math.min(total, s + half));
    return Math.atan2((b.lng - a.lng) * Math.cos(a.lat * Math.PI / 180), b.lat - a.lat);
  }
  function hud(html, buttons) {
    let box = el.querySelector('.fly-hud');
    if (!box) { box = document.createElement('div'); box.className = 'fly-hud'; box.setAttribute('role', 'status'); el.appendChild(box); }
    box.innerHTML = `<span>${html}</span>`;
    for (const [label, fn] of buttons) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.onclick = fn; box.appendChild(b); }
    return box;
  }
  // The glider: GlideCore.gliderMesh() drawn with WebGL in a canvas at the middle of the view, where the camera looks. It is
  // seen from the chase camera's own angle, and turned by its attitude: yaw against the camera's heading, the glide angle, bank.
  // Drawn larger than life: a 2 m model 170 m from the camera would be a few pixels across.
  const M4 = {
    mul(a, b) { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let v = 0; for (let k = 0; k < 4; k++) v += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = v; } return o; },
    persp(fovy, asp, n, f) { const t = 1 / Math.tan(fovy / 2); return new Float32Array([t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]); },
    look(e, u) { // looking at the origin from e
      const z = norm3(e), x = norm3(cross3(u, z)), y = cross3(z, x);
      return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot3(x, e), -dot3(y, e), -dot3(z, e), 1]);
    },
    rx(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); },
    ry(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); },
    rz(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); }
  };
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm3 = a => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
  const VS = `attribute vec3 p, n, c; uniform mat4 mvp, model; varying vec3 vn, vc, vp;
    void main() { vn = (model * vec4(n, 0.0)).xyz; vc = c; vp = (model * vec4(p, 1.0)).xyz; gl_Position = mvp * vec4(p, 1.0); }`;
  // gelcoat lit by the sun, the sky above and the ground below, with a gloss highlight; the canopy darker and glossier
  const FS = `precision mediump float; uniform vec3 sun, eye; varying vec3 vn, vc, vp;
    void main() {
      vec3 N = normalize(vn), V = normalize(eye - vp), H = normalize(sun + V);
      float glass = step(vc.r + vc.g + vc.b, 0.6);
      float diff = max(dot(N, sun), 0.0);
      vec3 amb = mix(vec3(0.30, 0.28, 0.24), vec3(0.55, 0.63, 0.75), 0.5 + 0.5 * N.y);
      float spec = pow(max(dot(N, H), 0.0), mix(50.0, 160.0, glass)) * mix(0.45, 1.2, glass);
      float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * mix(0.18, 0.5, glass);
      vec3 col = vc * (amb * 0.7 + diff * vec3(1.0, 0.97, 0.9) * 0.85) + vec3(spec) + rim * vec3(0.65, 0.75, 0.9);
      gl_FragColor = vec4(pow(col, vec3(1.0 / 1.25)), 1.0);
    }`;
  let gv = null;
  function gliderView() {
    if (gv) return gv;
    const cv = document.createElement('canvas');
    cv.className = 'fly-glider'; cv.setAttribute('aria-hidden', 'true');
    el.appendChild(cv);
    const gl = cv.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true });
    if (!gl) { cv.remove(); return null; }
    const sh = (type, src) => { const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); return o; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    const mesh = GlideCore.gliderMesh(), buf = (data, kind = gl.ARRAY_BUFFER) => { const b = gl.createBuffer(); gl.bindBuffer(kind, b); gl.bufferData(kind, data, gl.STATIC_DRAW); return b; };
    const bufs = { p: buf(mesh.pos), n: buf(mesh.nrm), c: buf(mesh.col) }, ib = buf(mesh.idx, gl.ELEMENT_ARRAY_BUFFER);
    const u = n => gl.getUniformLocation(prog, n);
    let span = 0; for (let i = 0; i < mesh.pos.length; i += 3) span = Math.max(span, 2 * Math.abs(mesh.pos[i]));
    gv = {
      canvas: cv,
      // look: the camera's angle down to the glider; yaw, pitch (nose down), bank (right wing down): radians
      draw({ look, yaw, pitch, bank }) {
        const dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
        if (!w || !h) return;
        if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
        gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST);
        gl.useProgram(prog);
        const D = 2.15 * span, eye = [0, D * Math.sin(look), -D * Math.cos(look)]; // the span fills most of the canvas
        const model = M4.mul(M4.ry(yaw), M4.mul(M4.rx(pitch), M4.rz(bank)));
        const mvp = M4.mul(M4.persp(17 * Math.PI / 180, w / h, D * 0.15, D * 2.5), M4.mul(M4.look(eye, [0, 1, 0]), model));
        gl.uniformMatrix4fv(u('mvp'), false, mvp); gl.uniformMatrix4fv(u('model'), false, model);
        gl.uniform3fv(u('eye'), eye); gl.uniform3fv(u('sun'), norm3([-0.45, 0.85, -0.3])); // high, over the camera's right shoulder
        for (const k of ['p', 'n', 'c']) { const a = gl.getAttribLocation(prog, k); gl.bindBuffer(gl.ARRAY_BUFFER, bufs[k]); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 3, gl.FLOAT, false, 0, 0); }
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
        gl.drawElements(gl.TRIANGLES, mesh.idx.length, gl.UNSIGNED_SHORT, 0);
      }
    };
    return gv;
  }
  function gliderIcon(on) { const g = gliderView(); if (g) g.canvas.style.display = on ? '' : 'none'; }
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
    flight = { raf: 0, grab, onEnd, t0: null, last: 0, bank: 0 };
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
      // the glider's attitude: its track here, the turn (bank for a coordinated turn at its airspeed), crab into the wind
      const dt = flight.last ? Math.min(0.1, (now - flight.last) / 1000) : 0; flight.last = now;
      const chi = trackAt(path, s, 20), camChi = Math.atan2(ux, uy);
      const turn = wrapPi(trackAt(path, Math.min(total, s + 35), 20) - trackAt(path, Math.max(0, s - 35), 20)) / Math.max(1, Math.min(total, s + 35) - Math.max(0, s - 35));
      const bankTo = Math.max(-0.8, Math.min(0.8, Math.atan(path.Va * path.Va * turn / 9.81)));
      flight.bank += (bankTo - flight.bank) * Math.min(1, dt / 0.6);
      const windTo = (path.wd + 180) * Math.PI / 180, cross = path.ws * Math.sin(windTo - chi) / path.Va;
      const heading = chi - Math.asin(Math.max(-0.9, Math.min(0.9, cross)));
      const air = now / 1000; // a little life in the air
      const g = gliderView();
      if (g) g.draw({ look: Math.atan2(camAlt - p.h, BACK), yaw: -wrapPi(heading - camChi) + 0.01 * Math.sin(air * 0.9),
                      pitch: Math.atan(1 / path.gr) + 0.012 * Math.sin(air * 1.7), bank: flight.bank + 0.02 * Math.sin(air * 1.3) + 0.01 * Math.sin(air * 3.1) });
      onAt(p.k);
      if (u < 1) {
        hud(`${U.d(s)} out, ${U.h(Math.max(0, p.h - p.g))} above the ground`, [['Stop', stop]]);
        flight.raf = requestAnimationFrame(frame);
      } else {
        endFlight(true);
        const left = path.h[path.h.length - 1] - path.g[path.g.length - 1]; // a route ends at the spot picked, maybe still high
        hud(left > 5 ? `At the spot after ${U.d(total)}, ${U.h(left)} above the ground` : `Down after ${U.d(total)}`, [['Fly again', () => fly(path, onAt, onEnd)], ['Done', () => { const b = el.querySelector('.fly-hud'); if (b) b.remove(); }]]);
      }
    };
    flight.raf = requestAnimationFrame(frame);
  }

  return {
    fly,
    // the glider alone at an attitude (radians: look, yaw, pitch, bank), for checking the model by eye
    preview(att) { const g = gliderView(); if (g) { g.canvas.style.display = ''; g.draw(att); } },
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
