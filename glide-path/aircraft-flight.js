// Version 1 aircraft interchange. Pure validation; never fetches a device or photo URL.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AircraftFlight = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const MAX_BYTES = 20 * 1024 * 1024;
  const object = v => v && typeof v === 'object' && !Array.isArray(v);
  const number = (v, lo, hi, name) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw Error('Invalid ' + name);
    return v;
  };
  const nullable = (v, lo, hi, name) => v == null ? null : number(v, lo, hi, name);
  const text = (v, max, name) => {
    if (typeof v !== 'string' || v.length > max || /[\u0000-\u001f]/.test(v)) throw Error('Invalid ' + name);
    return v;
  };
  function point(v) {
    if (!object(v)) throw Error('Invalid flight point');
    const location = v.location;
    if (!['gps', 'estimated', 'missing'].includes(location)) throw Error('Unknown location source');
    const p = {
      t_ms: number(v.t_ms, 0, Number.MAX_SAFE_INTEGER, 'device time'),
      utc_ms: nullable(v.utc_ms, 0, 8640000000000000, 'UTC time'), location,
      lat_deg: nullable(v.lat_deg, -90, 90, 'latitude'),
      lon_deg: nullable(v.lon_deg, -180, 180, 'longitude'),
      alt_m: nullable(v.alt_m, -20000, 100000, 'altitude'),
      state: v.state == null ? '' : text(v.state, 80, 'flight state'),
      roll_deg: nullable(v.roll_deg, -180, 180, 'roll'),
      pitch_deg: nullable(v.pitch_deg, -90, 90, 'pitch')
    };
    if (location === 'missing') {
      if (p.lat_deg != null || p.lon_deg != null) throw Error('Missing location must have no coordinates');
    } else if (p.lat_deg == null || p.lon_deg == null) throw Error('Located point needs both coordinates');
    if (location === 'gps' && v.gps_valid === false) throw Error('Invalid GPS fix cannot be a measured position');
    return p;
  }
  function photo(v) {
    const p = point(v);
    p.name = text(v.name, 100, 'photo filename');
    if (!/^(?:[0-9]{8}\/)?IMG[0-9]{5}\.JPG$/i.test(p.name)) throw Error('Unsupported photo filename');
    return p;
  }
  function sidecar(v) {
    if (!object(v) || v.schema !== 'p4c-photo' || v.version !== 1 || !object(v.location)) throw Error('Unsupported photo metadata');
    return photo({ name: v.file, t_ms: v.captured_ms, utc_ms: v.utc_ms,
      location: v.location.source === 'gps' ? 'gps' : v.location.source === 'unavailable' ? 'missing' : v.location.source,
      lat_deg: v.location.lat_deg, lon_deg: v.location.lon_deg, alt_m: v.location.alt_m,
      state: v.flight_state, roll_deg: v.attitude?.valid ? v.attitude.roll_deg : null,
      pitch_deg: v.attitude?.valid ? v.attitude.pitch_deg : null });
  }
  function validate(value) {
    if (Array.isArray(value) || value?.schema === 'p4c-photo') {
      const items = Array.isArray(value) ? value : [value];
      if (items.length > 5000) throw Error('Too many photos');
      return { schema: 'p4-flight', version: 1, source: 'recorded', frame: 'WGS84', track: [], photos: items.map(sidecar), events: [], plan: null };
    }
    if (!object(value) || value.schema !== 'p4-flight' || value.version !== 1 || value.frame !== 'WGS84') throw Error('Unsupported flight file or version');
    if (!['recorded', 'simulation'].includes(value.source)) throw Error('Unknown flight source');
    const list = (v, max, what) => { if (!Array.isArray(v) || v.length > max) throw Error('Invalid ' + what); return v; };
    const track = list(value.track || [], 100000, 'track').map(point);
    for (let i = 1; i < track.length; i++) if (track[i].t_ms <= track[i - 1].t_ms) throw Error('Track times must increase within one boot');
    const photos = list(value.photos || [], 5000, 'photos').map(photo);
    const names = new Set();
    for (const p of photos) { if (names.has(p.name)) throw Error('Duplicate photo filename'); names.add(p.name); }
    const events = list(value.events || [], 10000, 'events').map(e => {
      if (!object(e)) throw Error('Invalid diagnostic event');
      return { t_ms: number(e.t_ms, 0, Number.MAX_SAFE_INTEGER, 'event time'), code: text(e.code, 80, 'event code'), detail: e.detail == null ? '' : text(e.detail, 300, 'event detail') };
    });
    return { schema: 'p4-flight', version: 1, source: value.source, frame: 'WGS84', track, photos, events, plan: value.plan ?? null };
  }
  function parse(text) {
    if (typeof text !== 'string' || text.length > MAX_BYTES) throw Error('Flight file exceeds 20 MB');
    return validate(JSON.parse(text));
  }
  function segments(track, maxGapMs = 5000) {
    const parts = []; let part = null, previous = null;
    for (const p of track) {
      const gap = !previous || p.t_ms - previous.t_ms > maxGapMs || Math.abs(p.lon_deg - previous.lon_deg) > 180;
      if (p.location === 'missing') part = null;
      else {
        if (!part || part.location !== p.location || gap) { part = { location: p.location, points: [] }; parts.push(part); }
        part.points.push(p);
      }
      previous = p;
    }
    return parts;
  }
  function at(track, t) {
    if (!track.length) return null;
    let lo = 0, hi = track.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (track[mid].t_ms <= t) lo = mid + 1; else hi = mid; }
    return lo ? track[lo - 1] : null; // sampled values only; no fabricated GPS interpolation
  }
  return { MAX_BYTES, parse, validate, sidecar, segments, at };
});
