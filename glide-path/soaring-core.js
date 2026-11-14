// Terrain screening for lee-ridge dynamic-soaring candidates. This is a geometric heuristic,
// not a flow solver, a wind-shear measurement, or a prediction of sustainable flight.
// Mechanism: Richardson (2012), High-Speed Dynamic Soaring, WHOI / R/C Soaring Digest.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SoaringCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const RAD = Math.PI / 180;
  const LIMITS = Object.freeze({ relief: 15, leeAngle: 8, maxCell: 40, calm: 0.5, separation: 160 });
  const wrap = n => ((n % 360) + 360) % 360;
  // A bearing is where wind comes FROM; x points east, terrain rows point south.
  const flow = from => ({ x: -Math.sin(from * RAD), y: Math.cos(from * RAD) });
  function sample(terr, W, H, x, y) {
    if (x < 0 || y < 0 || x > W - 1 || y > H - 1) return NaN;
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    let h = 0;
    for (const [dx, dy, weight] of [[0, 0, (1-fx)*(1-fy)], [1, 0, fx*(1-fy)], [0, 1, (1-fx)*fy], [1, 1, fx*fy]]) {
      if (weight < 1e-10) continue;
      const v = terr[(iy + dy) * W + ix + dx];
      if (!Number.isFinite(v)) return NaN;
      h += v * weight;
    }
    return h;
  }
  function scan(o, terr, W, H = W) {
    const { cell, si, sj, maxR, windSpeed, windFromDeg } = o;
    const empty = state => ({ state, candidates: [], cell, limits: LIMITS });
    if (![cell, si, sj, maxR, windSpeed, windFromDeg].every(Number.isFinite) || cell <= 0 || maxR <= 0 || terr.length !== W * H) return empty('missing');
    if (windSpeed <= LIMITS.calm && !o.windAt) return empty('calm');
    if (cell > LIMITS.maxCell) return empty('coarse');
    const defaultFlow = flow(windFromDeg), run = Math.max(140, 5 * cell), near = Math.max(30, cell), r = maxR / cell;
    const found = []; let tested = 0, complete = 0, validTerrain = 0, calmPoints=0;
    let v=defaultFlow;
    const at = (x, y, d) => sample(terr, W, H, x + v.x * d / cell, y + v.y * d / cell);
    for (let y = Math.max(0, Math.ceil(sj-r)); y <= Math.min(H-1, Math.floor(sj+r)); y++) {
      for (let x = Math.max(0, Math.ceil(si-r)); x <= Math.min(W-1, Math.floor(si+r)); x++) {
        const distance = Math.hypot(x-si, y-sj) * cell;
        if (distance > maxR) continue;
        tested++;
        if(o.windAt){const w=o.windAt((x-si)*cell,(sj-y)*cell);const speed=Math.hypot(w.east,w.north);if(speed<=LIMITS.calm){calmPoints++;continue;}v={x:w.east/speed,y:-w.north/speed};}else v=defaultFlow;
        const h = terr[y * W + x], upNear = at(x,y,-near), leeNear = at(x,y,near);
        if (![h, upNear, leeNear].every(Number.isFinite)) continue;
        validTerrain++;
        // Crest must be locally higher on both sides along the wind, not just a lee-facing slope.
        if (h - upNear < 1 || h - leeNear < 2) continue;
        const ds = [-run, -run*.75, -run*.5, -run*.25, run*.25, run*.5, run*.75, run];
        const heights = ds.map(d => at(x,y,d));
        if (!heights.every(Number.isFinite)) continue;
        complete++;
        const rise = h - heights[0], drop = h - heights.at(-1), leeAngle = Math.atan2(drop, run) / RAD;
        if (rise < LIMITS.relief || drop < LIMITS.relief || leeAngle < LIMITS.leeAngle) continue;
        // An intervening higher ridge means this point is not the exposed crest of this section.
        if (heights.some(a => a > h + 1)) continue;
        const sharpness = h - (upNear + leeNear) / 2;
        found.push({ x, y, height: h, distance, rise, drop, leeAngle, run, windFrom: wrap(Math.atan2(-v.x,v.y)/RAD),
          score: Math.min(rise,drop) + sharpness * 2 });
      }
    }
    found.sort((a,b) => b.score-a.score || a.distance-b.distance || a.y-b.y || a.x-b.x);
    const candidates = [];
    for (const c of found) {
      if (candidates.every(p => Math.hypot(c.x-p.x,c.y-p.y)*cell >= LIMITS.separation)) candidates.push(c);
      if (candidates.length === 6) break;
    }
    return { state: candidates.length ? 'candidates' : calmPoints===tested?'calm':validTerrain ? 'none' : 'missing', candidates, cell, tested, complete, limits: LIMITS };
  }
  function section(c, terr, W, H, cell) {
    const v = flow(c.windFrom), span = c.run * 1.35, n = Math.max(32, Math.ceil(2*span / Math.max(2,cell/2)));
    const out = { d: [], ground: [], xy: [], crest: span, span: 2*span };
    for (let k=0;k<=n;k++) {
      const d = k/n*2*span, x = c.x + v.x*(d-span)/cell, y = c.y + v.y*(d-span)/cell;
      out.d.push(d); out.xy.push([x,y]); out.ground.push(sample(terr,W,H,x,y));
    }
    return out;
  }
  function windURL(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat)>85.05112878 || Math.abs(lon)>180) throw new Error('Choose a valid launch first.');
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.search = new URLSearchParams({ latitude: lat.toFixed(6), longitude: lon.toFixed(6),
      current: 'wind_speed_10m,wind_direction_10m,wind_gusts_10m', wind_speed_unit: 'ms', timeformat: 'unixtime', timezone: 'UTC', forecast_days: '1' }).toString();
    return url.href;
  }
  function parseWind(data, now = Date.now()) {
    const c = data?.current, u = data?.current_units;
    if (u?.wind_speed_10m !== 'm/s' || u?.wind_direction_10m !== '°' || u?.time !== 'unixtime') throw new Error('The wind service returned unexpected units.');
    if (![c?.wind_speed_10m,c?.wind_direction_10m,c?.time].every(Number.isFinite) || c.wind_speed_10m < 0 || c.wind_speed_10m > 60 || c.time < 0) throw new Error('The wind service returned incomplete data.');
    const time = c.time * 1000;
    if (time > now + 30*60000 || now - time > 2*3600000) throw new Error('The wind service returned an outdated forecast. Manual wind is unchanged.');
    const gust = c.wind_gusts_10m;
    return { speed: c.wind_speed_10m, from: wrap(c.wind_direction_10m), time,
      gust: u.wind_gusts_10m === 'm/s' && Number.isFinite(gust) && gust >= 0 ? gust : null, speed80:u.wind_speed_80m==='m/s'&&Number.isFinite(c.wind_speed_80m)?c.wind_speed_80m:null,from80:u.wind_direction_80m==='°'&&Number.isFinite(c.wind_direction_80m)?wrap(c.wind_direction_80m):null };
  }
  return { LIMITS, flow, sample, scan, section, windURL, parseWind };
});
