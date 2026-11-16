// Offline aircraft review. No network/device access, credentials or remote photo URLs.
aircraftUI = (() => {
  'use strict';
  const A = AircraftFlight, copy = CONTENT.aircraft_flight, marks = L.layerGroup().addTo(map);
  let flight = null, sample = null, pictureURLs = new Map(), features = [];
  const label = location => copy[location];
  const duration = t => (t / 1000).toFixed(1) + ' s';
  const clearPictures = () => { for (const url of pictureURLs.values()) URL.revokeObjectURL(url); pictureURLs.clear(); };
  const position = p => [p.lat_deg, p.lon_deg];
  const located = p => p && p.location !== 'missing';
  const pointFeature = (kind, p) => ({ type: 'Feature', properties: { k: kind }, geometry: { type: 'Point', coordinates: [p.lon_deg, p.lat_deg] } });
  const makeText = (tag, text) => { const el = document.createElement(tag); el.textContent = text; return el; };
  const photoURL = p => pictureURLs.get(p.name) || pictureURLs.get(p.name.split('/').pop());
  function photoDetail(p) {
    const box = document.createElement('div');
    box.append(makeText('strong', p.name), makeText('p', label(p.location) + ' · ' + duration(p.t_ms)));
    if (p.utc_ms != null) box.append(makeText('p', new Date(p.utc_ms).toISOString()));
    const url = photoURL(p);
    if (url) { const img = document.createElement('img'); img.src = url; img.alt = p.name; img.className = 'aircraft-photo'; box.append(img); }
    return box;
  }
  function renderMap() {
    marks.clearLayers(); features = [];
    if (!flight) { mark3d(); return; }
    for (const segment of A.segments(flight.track)) {
      const kind = segment.location === 'gps' ? 'aircraftGps' : 'aircraftEstimate';
      const points = segment.points.map(position);
      if (points.length > 1) {
        L.polyline(points, { color: segment.location === 'gps' ? C.flight : C.route, weight: 4, dashArray: segment.location === 'gps' ? null : '6 5', interactive: false }).addTo(marks);
        features.push({ type: 'Feature', properties: { k: kind }, geometry: { type: 'LineString', coordinates: segment.points.map(p => [p.lon_deg, p.lat_deg]) } });
      } else {
        L.circleMarker(points[0], { radius: 3, color: C.line, fillOpacity: 1 }).addTo(marks);
        features.push(pointFeature('aircraftTrackPoint', segment.points[0]));
      }
    }
    for (const p of flight.photos.filter(located)) {
      const pin = L.circleMarker(position(p), { radius: 6, weight: 2, color: C.casing, fillColor: p.location === 'gps' ? C.flight : C.route, fillOpacity: 1 }).addTo(marks);
      pin.bindPopup(() => photoDetail(p));
      features.push(pointFeature('aircraftPhoto', p));
    }
    if (located(sample)) {
      L.circleMarker(position(sample), { radius: 9, weight: 3, color: C.casing, fillColor: C.line, fillOpacity: 1 }).addTo(marks);
      features.push(pointFeature('aircraftSample', sample));
    }
    mark3d();
  }
  function renderSample() {
    if (!flight?.track.length) return;
    sample = A.at(flight.track, +$('aircraftTime').value);
    if (!sample) return;
    const readings = [duration(sample.t_ms), label(sample.location), sample.state];
    if (sample.alt_m != null) readings.push(sample.alt_m.toFixed(1) + ' m MSL');
    if (sample.roll_deg != null) readings.push('Roll ' + sample.roll_deg.toFixed(1) + '°');
    if (sample.pitch_deg != null) readings.push('Pitch ' + sample.pitch_deg.toFixed(1) + '°');
    $('aircraftSample').textContent = readings.filter(Boolean).join(' · ');
    renderMap();
  }
  function renderPhotos() {
    $('aircraftPhotos').replaceChildren();
    const photos = flight?.photos || [];
    $('aircraftPhotoCount').textContent = photos.length || '';
    if (!photos.length) $('aircraftPhotos').append(makeText('li', copy.no_photos));
    photos.forEach(p => {
      const li = document.createElement('li'), button = makeText('button', p.name + ' · ' + label(p.location));
      button.type = 'button'; button.className = 'btn sm'; button.onclick = () => {
        const details = li.querySelector('.aircraft-photo-detail');
        if (details) { details.remove(); return; }
        const box = photoDetail(p); box.className = 'aircraft-photo-detail'; li.append(box);
        if (located(p)) { if (is3d) set3d(false); map.panTo(position(p)); }
      };
      li.append(button); $('aircraftPhotos').append(li);
    });
  }
  function load(value) {
    const next = A.validate(value);
    if (next.plan) next.plan = GP.validatePlan(next.plan); // validate before changing the displayed file
    clearPictures(); flight = next; sample = null;
    const first = flight.track[0], last = flight.track.at(-1);
    $('aircraftReplay').hidden = !first;
    if (first) { $('aircraftTime').min = first.t_ms; $('aircraftTime').max = last.t_ms; $('aircraftTime').value = first.t_ms; }
    $('aircraftClear').disabled = false;
    $('aircraftFit').disabled = !flight.track.some(located) && !flight.photos.some(located);
    const source = !flight.track.length && !flight.photos.length && !flight.events.length && flight.plan ? copy.plan_only : flight.source === 'simulation' ? copy.source_simulation : copy.source_recorded;
    const gps = flight.track.filter(p => p.location === 'gps').length, estimated = flight.track.filter(p => p.location === 'estimated').length;
    $('aircraftOrigin').hidden = false; $('aircraftOrigin').textContent = source;
    $('flightRecordStatus').textContent = `${flight.track.length} samples · ${gps} GPS · ${estimated} estimated · ${flight.photos.length} photos`;
    $('aircraftSummary').textContent = flight.source === 'simulation' ? 'Simulation' : `${flight.track.length} samples`;
    $('aircraftPlan').hidden = !flight.plan;
    if (flight.plan) $('aircraftPlan').href = '#plan=' + GP.encode(flight.plan);
    $('aircraftEvents').replaceChildren();
    for (const e of flight.events) $('aircraftEvents').append(makeText('li', duration(e.t_ms) + ' · ' + e.code + (e.detail ? ' · ' + e.detail : '')));
    if (!flight.events.length) $('aircraftEvents').append(makeText('li', copy.no_events));
    renderPhotos(); if (first) renderSample(); else renderMap();
    return flight;
  }
  $('aircraftFile').onchange = async e => {
    const files = [...e.target.files];
    if (!files.length) return;
    try {
      if (files.some(f => f.size > A.MAX_BYTES) || files.reduce((n, f) => n + f.size, 0) > A.MAX_BYTES) throw Error('Flight files exceed 20 MB');
      const values = await Promise.all(files.map(async f => A.parse(await f.text())));
      if (values.length > 1 && values.some(v => v.track.length || v.events.length || v.plan)) throw Error('Open one flight file, or several photo metadata files');
      load(values.length === 1 ? values[0] : { ...values[0], photos: values.flatMap(v => v.photos) });
    } catch (error) { $('flightRecordStatus').textContent = error.message; }
    e.target.value = '';
  };
  $('aircraftPictures').onchange = e => {
    if (!flight) { $('flightRecordStatus').textContent = copy.empty; e.target.value = ''; return; }
    clearPictures();
    const files = [...e.target.files], counts = new Map(), metadataNames = new Map();
    for (const p of flight.photos) { const name = p.name.split('/').pop(); metadataNames.set(name, (metadataNames.get(name) || 0) + 1); }
    for (const f of files) counts.set(f.name, (counts.get(f.name) || 0) + 1);
    for (const f of files) if (counts.get(f.name) === 1 && metadataNames.get(f.name) === 1 && /^IMG\d{5}\.JPG$/i.test(f.name) && (f.type === 'image/jpeg' || !f.type)) pictureURLs.set(f.name, URL.createObjectURL(f));
    renderPhotos(); renderMap(); e.target.value = '';
    if ([...counts.values(), ...metadataNames.values()].some(n => n > 1)) $('flightRecordStatus').textContent = 'Duplicate photo names were skipped. Choose photos from one day at a time.';
  };
  $('aircraftTime').oninput = renderSample;
  $('aircraftFit').onclick = () => {
    if (!flight) return;
    const points = [...flight.track, ...flight.photos].filter(located).map(position);
    if (points.length) { if (is3d) set3d(false); map.fitBounds(points, { padding: [25, 25], maxZoom: 17 }); }
  };
  $('aircraftClear').onclick = () => {
    clearPictures(); flight = sample = null; renderMap(); renderPhotos();
    $('aircraftReplay').hidden = $('aircraftPlan').hidden = true;
    $('aircraftFit').disabled = $('aircraftClear').disabled = true;
    $('aircraftEvents').replaceChildren(); $('aircraftSummary').textContent = '';
    $('flightRecordStatus').textContent = copy.empty; $('aircraftOrigin').hidden = true;
  };
  $('aircraftExportPlan').onclick = () => {
    const plan = currentPlan(); if (!plan) return;
    const blob = new Blob([JSON.stringify({ schema: 'p4-flight', version: 1, source: 'recorded', frame: 'WGS84', track: [], photos: [], events: [], plan }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'aircraft-plan.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $('aircraftPlan').onclick = e => { e.preventDefault(); if (flight?.plan) location.assign($('aircraftPlan').href); location.reload(); };
  window.addEventListener('beforeunload', clearPictures);
  return { load, render: renderMap, features: () => features };
})();
