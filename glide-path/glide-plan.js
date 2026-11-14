// Flight-plan data and destination inspection, without DOM or storage. All model values are SI;
// changing display units never changes a plan. UMD so the browser and host checks use one copy.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./glide-core.js'),require('./wind-core.js'));
  else root.GlidePlan = factory(root.GlideCore,root.WindCore);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (G, Wind) {
  'use strict';
  const SPEC = {
    gr:  { metric: [1, 30, 0.5, ':1'], imperial: [1, 30, 0.5, ':1'], k: 1, def: 15 },
    va:  { metric: [5, 25, 0.5, 'm/s'], imperial: [10, 55, 1, 'mph'], k: G.MPH, def: 10 },
    agl: { metric: [0, 300, 5, 'm'], imperial: [0, 1000, 10, 'ft'], k: G.FT, def: 120 },
    ws:  { metric: [0, 40, 0.5, 'm/s'], imperial: [0, 90, 1, 'mph'], k: G.MPH, def: 0 },
    vis: { metric: [100, 3000, 50, 'm'], imperial: [300, 10000, 100, 'ft'], k: G.FT, def: 600 },
    mg:  { metric: [0, 60, 5, 'm'], imperial: [0, 200, 10, 'ft'], k: G.FT, def: 20 },
    sl:  { metric: [2, 30, 1, '°'], imperial: [2, 30, 1, '°'], k: 1, def: 12 }
  };
  const wrap = x => ((x % 360) + 360) % 360;
  const bounds = k => [Math.min(SPEC[k].metric[0], SPEC[k].imperial[0] / SPEC[k].k), Math.max(SPEC[k].metric[1], SPEC[k].imperial[1] / SPEC[k].k)];
  const factor = (k, units) => units === 'imperial' ? SPEC[k].k : 1;
  const display = (k, value, units) => Number((value * factor(k, units)).toFixed(3));
  function inputValue(k, value, units) {
    if (!(k in SPEC) || !Number.isFinite(value)) throw new Error('Enter a valid number.');
    const metric = value / factor(k, units), [lo, hi] = bounds(k);
    if (metric < lo - 1e-8 || metric > hi + 1e-8) throw new Error(`Enter a value between ${display(k, lo, units)} and ${display(k, hi, units)}.`);
    return Math.max(lo, Math.min(hi, metric));
  }
  function parameters(input = {}, strict = false) {
    const out = {};
    for (const [k, s] of Object.entries(SPEC)) {
      const [lo, hi] = bounds(k), v = input[k];
      if (strict && (!Number.isFinite(v) || v < lo || v > hi)) throw new Error(`Invalid flight parameter: ${k}.`);
      out[k] = Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : s.def;
    }
    for (const [k, fallback] of [['wd', 270], ['pb', 180]]) {
      if (strict && !Number.isFinite(input[k])) throw new Error(`Invalid direction: ${k}.`);
      out[k] = Number.isFinite(input[k]) ? wrap(input[k]) : fallback;
    }
    if (strict && typeof input.curve !== 'boolean') throw new Error('Invalid route setting.');
    out.curve = input.curve !== false;
    return out;
  }
  function coordinates(p) {
    const lon = p?.lon ?? p?.lng;
    if (!Number.isFinite(p?.lat) || !Number.isFinite(lon) || Math.abs(p.lat) > 85.05112878 || Math.abs(lon) > 180) throw new Error('Enter valid latitude and longitude (latitude between −85 and 85).');
    return { lat: p.lat, lon };
  }
  function validatePlan(data) {
    if (!data || data.version !== 1) throw new Error('This is not a supported Dyna-soar plan.');
    const out = { version: 1, launch: coordinates(data.launch), params: parameters(data.params, true),
      target: data.target ? coordinates(data.target) : null, units: data.units === 'imperial' ? 'imperial' : 'metric',windModel:Wind.inputs(data.windModel||{enabled:false}) };
    return out;
  }
  const encode = plan => encodeURIComponent(JSON.stringify(validatePlan(plan)));
  function decode(text) {
    if (typeof text !== 'string' || text.length > 12000) throw new Error('This flight-plan link is too large.');
    try { return validatePlan(JSON.parse(decodeURIComponent(text))); }
    catch (err) { throw new Error(`Could not open the flight-plan link: ${err.message}`); }
  }
  const close = (a, b) => typeof a === 'boolean' ? a === b : Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b));
  function differences(a, b) {
    if (!a || !b) return [];
    return Object.keys(parameters()).filter(k => !close(a[k], b[k]));
  }
  function samePlan(a, b) {
    if (!a || !b || differences(a.params, b.params).length || JSON.stringify(Wind.inputs(a.windModel||{enabled:false}))!==JSON.stringify(Wind.inputs(b.windModel||{enabled:false}))) return false;
    const point = (p, q) => !p || !q ? p === q : close(p.lat, q.lat) && close(p.lon ?? p.lng, q.lon ?? q.lng);
    return point(a.launch, b.launch) && point(a.target, b.target);
  }
  function aircraft(value) {
    if (!value || !['gr', 'va', 'vis'].every(k => Number.isFinite(value[k]) && value[k] >= bounds(k)[0] && value[k] <= bounds(k)[1])) throw new Error('Invalid aircraft settings.');
    return { gr: value.gr, va: value.va, vis: value.vis };
  }
  function routeStats(cells, alt, terr, width, cell, midAlt) {
    let distance = 0, clearance = Infinity;
    for (let k = 0; k < cells.length; k++) {
      const i = cells[k];
      clearance = Math.min(clearance, alt[i] - terr[i]);
      if (!k) continue;
      const prev = cells[k - 1], dx = i % width - prev % width, dy = Math.floor(i / width) - Math.floor(prev / width);
      distance += Math.hypot(dx, dy) * cell;
      const sx = Math.sign(dx), sy = Math.sign(dy), mids = Math.abs(dx) === 2 ? [[sx, 0], [sx, sy]] : Math.abs(dy) === 2 ? [[0, sy], [sx, sy]] : dx && dy ? [[sx, 0], [0, sy]] : [];
      for (const [mx, my] of mids) clearance = Math.min(clearance, (Number.isFinite(midAlt?.[i])?midAlt[i]:(alt[prev] + alt[i])/2) - terr[prev + my * width + mx]);
    }
    return { distance, clearance: Number.isFinite(clearance) ? clearance : null };
  }
  // Classifies the selected ground, independently from the colour/wording used by the UI.
  function inspect({ params: p, rays, grid, result, index, distance, bearing, ground, slope, missing = false }) {
    const out = { distance, ground, slope, cells: [], arrival: null, routeDistance: null, clearance: null, reachable: false, potential: false, kind: 'unknown' };
    if (!Number.isFinite(ground)) return { ...out, kind: 'missing', reason: 'Terrain is missing at this destination.' };
    if (distance > p.vis) return { ...out, kind: 'sight', reason: 'Outside the sight distance set for this plan.' };
    if (p.curve) {
      if (!result) return { ...out, kind: 'pending', reason: 'Updating the route to this destination…' };
      const cells = G.routeTo(result.parent, result.alt, index);
      if (cells.length) {
        const stats = routeStats(cells, result.alt, grid.terr, grid.GW, grid.cell, result.midAlt);
        out.cells = cells; out.arrival = result.alt[index] - ground; out.routeDistance = stats.distance; out.clearance = stats.clearance; out.reachable = true;
      }
    } else {
      if (!rays) return { ...out, kind: 'pending', reason: 'Updating the straight glide to this destination…' };
      const ratio = G.reachAt(rays, bearing, distance);
      if (ratio > 0) { out.reachable = true; out.arrival = rays.h0 - distance / ratio - ground; out.routeDistance = distance; }
    }
    if (out.reachable) {
      if (!Number.isFinite(slope)) return { ...out, kind: 'slope', reason: 'Reachable in the model, but missing terrain prevents a slope assessment here.' };
      out.potential = Number.isFinite(slope) && slope <= p.sl;
      return { ...out, kind: out.potential ? 'potential' : 'steep', reason: out.potential ? 'Slope is within the selected limit. Trees, water and obstacles are not assessed.' : 'Reachable in the model, but the ground exceeds the selected slope limit.' };
    }
    if (G.groundSpeed(bearing, p.va, p.ws, p.wd * Math.PI / 180) <= 0) return { ...out, kind: 'wind', reason: 'The set wind prevents progress toward this destination.' };
    if (missing) return { ...out, kind: 'incomplete', reason: 'No route found with the available terrain. Coverage is incomplete.' };
    return { ...out, kind: 'blocked', reason: p.curve ? 'No route satisfies the terrain clearance, wind and sight constraints.' : 'The straight glide is blocked by terrain or clearance. Enable curving to search for an alternative.' };
  }
  return { SPEC, wrap, bounds, factor, display, inputValue, parameters, coordinates, validatePlan, encode, decode, differences, samePlan, aircraft, inspect, routeStats };
});
