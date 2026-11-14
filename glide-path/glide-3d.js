// DynaSoar in 3D: the same map tilted, drawn by MapLibre GL (vendored in lib/maplibre/), loaded by glide-app.js the
// first time 3D is opened. The mountains are the same Terrarium tiles the reach is worked out on (to zoom 13), so the
// reach colours, drawn into the page's own canvas, lie exactly on the ground they describe. Everything else is read
// from the 2D map's layers on each change (`mark`), so the 2D map stays the one source of truth.
'use strict';
function Glide3D(env) {
  const { lmap, el, L: layers, terrUrl, tiles, onTap } = env;
  let C = env.pal(), colourKey = JSON.stringify(C); // the colours in use: they follow the base map, as on the 2D map
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
      line('profLine', 'lines', { 'line-color': C.flight, 'line-width': 3, 'line-opacity': 0.95 }),
      line('routeCase', 'lines', { 'line-color': C.casing, 'line-width': 7, 'line-opacity': 0.9 }),
      line('routeLine', 'lines', { 'line-color': C.route, 'line-width': 4 }),
      line('windCase','lines',{'line-color':C.casing,'line-width':5}),
      line('windLine','lines',{'line-color':C.line,'line-width':1.5}),
      { id: 'dsArea', type: 'fill', source: 'lines', filter: is('dsArea'), paint: { 'fill-color': C.line, 'fill-opacity': .12 } },
      line('dsCrestCase', 'lines', { 'line-color': C.casing, 'line-width': 8 }),
      line('dsCrest', 'lines', { 'line-color': C.line, 'line-width': 4 }),
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
    set('profCase', 'line-color', C.casing); set('profPast', 'line-color', C.line); set('profLine', 'line-color', C.flight);
    set('windCase','line-color',C.casing);set('windLine','line-color',C.line);set('dsArea','fill-color',C.line); set('dsCrestCase','line-color',C.casing); set('dsCrest','line-color',C.line);set('dsCase', 'line-color', C.casing); set('dsLine', 'line-color', C.line);
    set('routeCase', 'line-color', C.casing); set('routeLine', 'line-color', C.route);
    set('ticks', 'circle-color', C.casing); set('ticks', 'circle-stroke-color', C.line);
    set('routeEnd', 'circle-color', C.route); set('routeEnd', 'circle-stroke-color', C.casing);
    set('probe', 'circle-color', C.line); set('probe', 'circle-stroke-color', C.casing);
  }

  // Absolute MSL trajectory, depth-tested against terrain; ground traces remain normal map layers.
  // Rebase vertices at the launch before converting to float32 to preserve sub-metre precision.
  let airData=null,airVersion=0,airProfile,airColour;
  function updateAir() {
    const p=env.profile?.(),color=env.profileColour();
    if(p===airProfile&&color===airColour)return;
    airProfile=p;airColour=color;
    if(!p||p.end<1){airData=null;airVersion++;return;}
    const origin=maplibregl.MercatorCoordinate.fromLngLat(ll(p.lls[0]),0),vertices=[];
    const coord=k=>{const v=maplibregl.MercatorCoordinate.fromLngLat(ll(p.lls[k]),p.glide[k]);return [v.x-origin.x,v.y-origin.y,v.z];};
    for(let k=1;k<=p.end;k++) {
      if(!Number.isFinite(p.glide[k-1])||!Number.isFinite(p.glide[k]))continue;
      const a=coord(k-1),b=coord(k);
      for(const [end,side] of [[0,-1],[1,-1],[1,1],[0,-1],[1,1],[0,1]])vertices.push(...a,...b,end,side);
    }
    airData={origin,vertices:new Float32Array(vertices),color};airVersion++;
  }
  const airLayer={id:'air-trajectory',type:'custom',renderingMode:'3d',
    onAdd(map,gl){
      const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
      this.program=gl.createProgram();
      const vs=shader(gl.VERTEX_SHADER,`attribute vec3 a,b; attribute vec2 edge; uniform mat4 matrix; uniform vec2 viewport; uniform float width;
        void main(){vec4 p=matrix*vec4(a,1.0),q=matrix*vec4(b,1.0);vec4 v=mix(p,q,edge.x);
          vec2 delta=(q.xy/q.w-p.xy/p.w)*viewport;vec2 normal=vec2(-delta.y,delta.x)/max(length(delta),0.00001);
          v.xy+=normal*edge.y*width/viewport*v.w;gl_Position=v;}`);
      const fs=shader(gl.FRAGMENT_SHADER,`precision mediump float;uniform vec3 color;void main(){gl_FragColor=vec4(color,1.0);}`);
      gl.attachShader(this.program,vs);gl.attachShader(this.program,fs);gl.linkProgram(this.program);
      gl.deleteShader(vs);gl.deleteShader(fs);
      if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(this.program));
      this.buffer=gl.createBuffer();this.vao=gl.createVertexArray();this.version=-1;
    },
    render(gl,args){
      if(!airData||!airData.vertices.length)return;
      gl.bindVertexArray(this.vao);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
      if(this.version!==airVersion){gl.bufferData(gl.ARRAY_BUFFER,airData.vertices,gl.DYNAMIC_DRAW);this.version=airVersion;}
      gl.useProgram(this.program);
      for(const [name,size,offset] of [['a',3,0],['b',3,12],['edge',2,24]]){const at=gl.getAttribLocation(this.program,name);gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,size,gl.FLOAT,false,32,offset);}
      const matrix=Array.from(args.defaultProjectionData.mainMatrix),o=airData.origin;
      for(let r=0;r<4;r++)matrix[12+r]+=matrix[r]*o.x+matrix[4+r]*o.y;
      const uniform=name=>gl.getUniformLocation(this.program,name);
      gl.uniformMatrix4fv(uniform('matrix'),false,matrix);gl.uniform2f(uniform('viewport'),gl.drawingBufferWidth,gl.drawingBufferHeight);
      gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(false);gl.disable(gl.CULL_FACE);gl.disable(gl.BLEND);
      const rgb=hex=>[1,3,5].map(k=>parseInt(hex.slice(k,k+2),16)/255),dpr=window.devicePixelRatio||1;
      for(const [color,width] of [[C.casing,6],[airData.color,3]]){gl.uniform3fv(uniform('color'),rgb(color));gl.uniform1f(uniform('width'),width*dpr);gl.drawArrays(gl.TRIANGLES,0,airData.vertices.length/8);}
      gl.bindVertexArray(null);
    },
    onRemove(map,gl){gl.deleteBuffer(this.buffer);gl.deleteProgram(this.program);gl.deleteVertexArray(this.vao);}
  };

  function sync() {
    queued = false;
    if (!open || !ready) return;
    if (JSON.stringify(env.pal()) !== colourKey) { C = env.pal(); colourKey=JSON.stringify(C); paintColours(); }
    updateAir();
    if(!m.getLayer('air-trajectory'))m.addLayer(airLayer);
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
    for (const c of ds.items) {
      add(lineFeature('dsCase', c.outline)); add(lineFeature('dsLine', c.outline));
      add(lineFeature('dsCrestCase',c.crest)); add(lineFeature('dsCrest',c.crest));
      if(c.selected) {
        add({type:'Feature',properties:{k:'dsArea'},geometry:{type:'Polygon',coordinates:[c.outline.map(ll)]}});
        add(lineFeature('windCase',c.arrow)); add(lineFeature('windLine',c.arrow));
      }
    }
    if (ds.key !== dsKey) {
      dsKey = ds.key; dsMarkers.forEach(pin => pin.remove()); dsMarkers = [];
      for (const c of ds.items) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'ds-pin ds-3d-pin' + (c.selected ? ' selected' : '');
        button.innerHTML = `<span>${c.selected ? env.ridgeLabel+' ' : ''}${c.index + 1}</span>`; button.setAttribute('aria-label', `Inspect candidate ridge ${c.index + 1}`);
        button.onclick = e => { e.stopPropagation(); env.onSoaring(c.index); };
        dsMarkers.push(new maplibregl.Marker({ element: button, anchor: 'center' }).setLngLat(ll(c.point)).addTo(m));
        if(c.selected) for(const label of c.labels) {
          const el = document.createElement('div'); el.className = 'ridge-label';
          const span = document.createElement('span'); span.textContent = label.text; el.append(span);
          dsMarkers.push(new maplibregl.Marker({element:el}).setLngLat(ll(label.point)).addTo(m));
        }
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

  function create(camera) {
    const c = lmap.getCenter();
    m = new maplibregl.Map({ container: el, style, center: [c.lng, c.lat], zoom: lmap.getZoom() - 1, pitch: camera.pitch, bearing: camera.bearing,
                             maxPitch: 80, maxZoom: 24, attributionControl: { compact: true } });
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    const launchPin = document.createElement('div'); launchPin.className = 'launch-pin'; launchPin.innerHTML = '<span>L</span>';
    launchPin.setAttribute('aria-label', 'Launch (drag to move)');
    marker = new maplibregl.Marker({ element: launchPin, draggable: true }).setLngLat([c.lng, c.lat]).addTo(m);
    marker.on('dragend', () => { const p = marker.getLngLat(); (env.onMoveLaunch || onTap)(p.lat, p.lng); });
    m.on('click', e => onTap(e.lngLat.lat, e.lngLat.lng));
    m.on('contextmenu', e => env.onInspect?.(e.lngLat));
    m.on('mousemove', e => env.onHover?.(e.point));
    m.on('mouseout', () => env.onOut?.());
    m.on('move', () => env.onCamera?.(m.getBearing(), m.getPitch()));
    m.on('moveend', () => env.onViewport?.());
    m.on('resize', () => env.onViewport?.());
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
  function at(path, s) {
    const d = path.d; let k = 0;
    while (k < d.length - 2 && d[k + 1] < s) k++;
    const f = d[k + 1] > d[k] ? Math.min(1, Math.max(0, (s - d[k]) / (d[k + 1] - d[k]))) : 0, a = path.lls[k], b = path.lls[k + 1] || a;
    const lerp = (x, y) => x + (y - x) * f;
    return { segment:k, k: f > 0.5 ? k + 1 : k, lat: lerp(a.lat, b.lat), lng: lerp(a.lng, b.lng), h: lerp(path.h[k], path.h[k + 1] ?? path.h[k]),
             g: lerp(path.g[k], path.g[k + 1] ?? path.g[k]) };
  }
  // the track's direction (radians clockwise from north) at s, over ±half metres
  const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));
  function trackAt(path, s, half) {
    const total = path.d[path.d.length - 1], a = at(path, Math.max(0, s - half)), b = at(path, Math.min(total, s + half));
    return Math.atan2((b.lng - a.lng) * Math.cos(a.lat * Math.PI / 180), b.lat - a.lat);
  }
  function airState(path,s) {
    const p=at(path,s),chi=trackAt(path,s,20),i=p.segment;
    const w=path.wind?.[i]||{east:-Math.sin(path.wd*Math.PI/180)*path.ws,north:-Math.cos(path.wd*Math.PI/180)*path.ws};
    const vertical=path.sink?.[i+1]??GlideCore.steadyGlide(path.Va,path.gr).sink;
    const horizontal=Math.sqrt(Math.max(0.01,path.Va*path.Va-vertical*vertical));
    const cross=(w.east*Math.cos(chi)-w.north*Math.sin(chi))/horizontal;
    const heading=chi-Math.asin(Math.max(-1,Math.min(1,cross)));
    const speed=GlideCore.groundSpeed(chi,horizontal,Math.hypot(w.east,w.north),Math.atan2(-w.east,-w.north));
    return {heading,horizontal,vertical,speed};
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
  // The terrain camera is calibrated to this same mesh so its screen size also has the right physical scale.
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
      canvas: cv, span,
      // look: the camera's angle down to the glider; yaw, pitch (nose down), bank (right wing down): radians
      draw({ look, yaw, pitch, bank, scale = 1 }) {
        const dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
        if (!w || !h) return;
        if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
        gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST);
        gl.useProgram(prog);
        const D = GlideCore.FLIGHT_VIEW.distance * span / scale, eye = [0, D * Math.sin(look), -D * Math.cos(look)]; // the span fills most of the canvas
        const model = M4.mul(M4.ry(yaw), M4.mul(M4.rx(pitch), M4.rz(bank)));
        const mvp = M4.mul(M4.persp(GlideCore.FLIGHT_VIEW.fov * Math.PI / 180, w / h, D * 0.15, D * 2.5), M4.mul(M4.look(eye, [0, 1, 0]), model));
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
    env.onViewport?.(); mark();
  }
  function fly(path, onAt, onEnd) {
    if (!ready) { m.once('load', () => fly(path, onAt, onEnd)); return; }
    endFlight();
    const total = path.d[path.d.length - 1], dur = Math.min(40, Math.max(8, 6 + total / 250)) * 1000, U = path.U;
    const hint = el.querySelector('.hint3d'); if (hint) hint.classList.add('gone');
    // dragging or zooming the map yourself ends the flight
    const grab = e => { if (e.originalEvent) { endFlight(); } };
    flight = { raf: 0, grab, onEnd, t0: null, last: 0, bank: 0 };
    m.on('movestart', grab); mark();
    m.setCenterClampedToGround(false); // the camera looks at the glider in the air, not at the ground under it
    gliderIcon(true);
    let ux = 0, uy = 1; // the way along the track, east and north
    const stop = () => endFlight();
    const frame = now => {
      if (!flight) return;
      if (flight.t0 === null) flight.t0 = now;
      const u = Math.min(1, (now - flight.t0) / dur);
      let s=total*u;
      if(path.time?.at(-1)>0){const t=u*path.time.at(-1);let k=0;while(k<path.time.length-2&&path.time[k+1]<t)k++;const f=(t-path.time[k])/Math.max(1e-9,path.time[k+1]-path.time[k]);s=path.d[k]+(path.d[k+1]-path.d[k])*f;}
      const p = at(path, s), q = at(path, Math.min(total, s + 80));
      const cos = Math.cos(p.lat * Math.PI / 180), ex = (q.lng - p.lng) * cos, ny = q.lat - p.lat, len = Math.hypot(ex, ny);
      if (len > 1e-9) { ux = ex / len; uy = ny / len; }
      const g = gliderView();
      const camera = GlideCore.flightCamera(g?.span || 2, g?.canvas.clientHeight || 120, el.clientHeight, m.getVerticalFieldOfView());
      const mPerDeg = 111320, fromLat = p.lat - uy * camera.back / mPerDeg, fromLng = p.lng - ux * camera.back / (mPerDeg * cos);
      const ground = m.queryTerrainElevation([fromLng, fromLat]) || 0;
      const camAlt = Math.max(p.h + camera.up, ground + camera.clearance);
      m.jumpTo(m.calculateCameraOptionsFromTo([fromLng, fromLat], camAlt, [p.lng, p.lat], p.h));
      // the glider's attitude: its track here, the turn (bank for a coordinated turn at its airspeed), crab into the wind
      const dt = flight.last ? Math.min(0.1, (now - flight.last) / 1000) : 0; flight.last = now;
      const camChi = Math.atan2(ux, uy),state=airState(path,s),before=Math.max(0,s-20),after=Math.min(total,s+20);
      const headingRate=wrapPi(airState(path,after).heading-airState(path,before).heading)/Math.max(.01,after-before)*state.speed;
      const bankTo=Math.max(-.8,Math.min(.8,Math.atan(state.horizontal*headingRate/9.81)));
      flight.bank+=(bankTo-flight.bank)*Math.min(1,dt/.6);
      const heading=state.heading,pitch=Math.asin(Math.min(.99,state.vertical/path.Va));
      if (g) g.draw({ look: Math.atan2(camAlt - p.h, camera.back), scale: camera.distance / Math.hypot(camera.back, camAlt-p.h), yaw: -wrapPi(heading - camChi),
                      pitch, bank: flight.bank });
      onAt(p.k);
      if (u < 1) {
        hud(`${U.d(s)} out, ${U.h(Math.max(0, p.h - p.g))} above the ground`, [['Stop', stop]]);
        flight.raf = requestAnimationFrame(frame);
      } else {
        endFlight(true);
        const left = path.h[path.h.length - 1] - path.g[path.g.length - 1]; // a route ends at the spot picked, maybe still high
        hud(`Preview ends after ${U.d(total)}, ${U.h(Math.max(0,left))} above the ground`, [['Fly again', () => fly(path, onAt, onEnd)], ['Done', () => { const b = el.querySelector('.fly-hud'); if (b) b.remove(); }]]);
      }
    };
    flight.raf = requestAnimationFrame(frame);
  }

  return {
    fly,
    get trajectory() { return airData ? { vertices:airData.vertices.length/8, color:airData.color } : null; },
    get flying() { return !!flight; },
    project(point) { return m.project(ll(point)); },
    unproject(point) { return m.unproject(point); },
    panInside(point) {
      const p = m.project(ll(point)), w = el.clientWidth, h = el.clientHeight;
      if (p.x < 36 || p.y < 36 || p.x > w-36 || p.y > h-36) m.jumpTo({center:ll(point)});
    },
    get camera() { return m ? { bearing: m.getBearing(), pitch: m.getPitch(), zoom: m.getZoom(), center: m.getCenter() } : null; },
    // the glider alone at an attitude (radians: look, yaw, pitch, bank), for checking the model by eye
    preview(att) { const g = gliderView(); if (g) { g.canvas.style.display = ''; g.draw(att); } },
    open(camera = { bearing: 0, pitch: 62 }) {
      const wasOpen = open;
      open = true; el.hidden = false;
      if (!m) create(camera);
      m.resize();
      const c = lmap.getCenter(), options = { bearing: camera.bearing, pitch: camera.pitch };
      if (!wasOpen) { options.center = [c.lng, c.lat]; options.zoom = lmap.getZoom() - 1; }
      if (camera.center) options.center = ll(camera.center);
      if (Number.isFinite(camera.zoom)) options.zoom = camera.zoom;
      m.jumpTo(options);
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
