// GlideCore: the maths behind /glide-reach/, with no DOM, so script/test-glide can run it in Node.
//   groundSpeed   ground speed along a straight track in steady wind
//   castRays      march rays out from the launch until the glide path (minus a margin) meets the terrain
//   reachAt       is a point (bearing, distance) inside the reachable set?
//   lonLatToPx / pxToLonLat / mppAt   Web Mercator pixels at a zoom
//   decodeTerrarium   one Terrarium RGB pixel to metres
//   areaTiles     the terrain tiles a saved area needs, per zoom
//   tilesOnlyIn   which saved tiles can go when an area is deleted (ones no other area uses)
(function (root, factory) {
  const core = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  else root.GlideCore = core;
})(typeof self !== 'undefined' ? self : this, function () {
  const D2R = Math.PI / 180;
  const TS = 256;
  const EARTH_C = 40075016.686; // equatorial circumference, m

  // Along-track ground speed holding a straight track on `brg` (rad from north, clockwise) at airspeed Va,
  // with wind blowing FROM windFrom (rad). Returns 0 when the track can't be flown (crosswind >= Va, or
  // a headwind that stops the glider).
  function groundSpeed(brg, Va, windSpeed, windFrom) {
    const ux = Math.sin(brg), uy = Math.cos(brg);
    const wx = -Math.sin(windFrom) * windSpeed, wy = -Math.cos(windFrom) * windSpeed;
    const along = wx * ux + wy * uy;
    const cross = wx * uy - wy * ux;
    if (Math.abs(cross) >= Va) return 0;
    const vg = Math.sqrt(Va * Va - cross * cross) + along;
    return vg > 0 ? vg : 0;
  }

  // Cast o.n rays. elevAt(eastM, northM) gives terrain height or NaN outside the data.
  // o: { n, h0 (start altitude, m), margin, Va, GR, windSpeed, windFromDeg, ds (step, m), maxD }
  // kind per ray: 0 = met the terrain, 1 = ran off the data, 2 = track not flyable in this wind
  function castRays(o, elevAt) {
    const n = o.n, sink = o.Va / o.GR;
    const dmax = new Float32Array(n), kind = new Uint8Array(n), grg = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const brg = (i / n) * 2 * Math.PI;
      const vg = groundSpeed(brg, o.Va, o.windSpeed, o.windFromDeg * D2R);
      if (vg <= 0) { kind[i] = 2; continue; }
      const g = vg / sink; grg[i] = g;
      const ux = Math.sin(brg), uy = Math.cos(brg);
      let last = 0, k = 1;
      for (let d = o.ds; d <= o.maxD; d += o.ds) {
        const h = o.h0 - d / g;
        const t = elevAt(ux * d, uy * d);
        if (t !== t) { k = 1; break; }
        if (h - o.margin <= t) { k = 0; break; }
        last = d;
      }
      dmax[i] = last; kind[i] = k;
    }
    return { dmax, kind, grg, n };
  }

  // Ground glide ratio if the point is reachable, else 0. Takes the shorter of the two neighbouring rays.
  function reachAt(R, brg, dist) {
    let f = (brg / (2 * Math.PI)) * R.n; if (f < 0) f += R.n;
    const i0 = Math.floor(f) % R.n, i1 = (i0 + 1) % R.n;
    const dm = Math.min(R.dmax[i0], R.dmax[i1]);
    return dist <= dm ? (R.grg[i0] + R.grg[i1]) / 2 : 0;
  }

  function lonLatToPx(lon, lat, z) {
    const s = TS * 2 ** z, sl = Math.sin(lat * D2R);
    return [(lon + 180) / 360 * s, (0.5 - Math.log((1 + sl) / (1 - sl)) / (4 * Math.PI)) * s];
  }
  function pxToLonLat(x, y, z) {
    const s = TS * 2 ** z, n = Math.PI - 2 * Math.PI * y / s;
    return [x / s * 360 - 180, Math.atan(Math.sinh(n)) / D2R];
  }
  const mppAt = (lat, z) => EARTH_C * Math.cos(lat * D2R) / (TS * 2 ** z);

  const decodeTerrarium = (r, g, b) => r * 256 + g + b / 256 - 32768;

  // Tiles to save for an area centred on (lat, lon): at zoom `z` the (2r+1)² block around the launch tile,
  // and at each lower zoom down to zMin the tiles covering the same ground (for the shaded map when zoomed out).
  function areaTiles(lat, lon, z, r, zMin) {
    const [px, py] = lonLatToPx(lon, lat, z);
    const tx = Math.floor(px / TS), ty = Math.floor(py / TS);
    const out = [];
    for (let zz = z; zz >= zMin; zz--) {
      const f = 2 ** (z - zz);
      const x0 = Math.floor((tx - r) / f), x1 = Math.floor((tx + r) / f);
      const y0 = Math.floor((ty - r) / f), y1 = Math.floor((ty + r) / f);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([zz, x, y]);
    }
    return out;
  }

  // Keys in `area` that no area in `others` also uses.
  function tilesOnlyIn(area, others) {
    const keep = new Set();
    for (const o of others) for (const k of o) keep.add(k);
    return area.filter(k => !keep.has(k));
  }

  return { groundSpeed, castRays, reachAt, lonLatToPx, pxToLonLat, mppAt, decodeTerrarium, areaTiles, tilesOnlyIn, TS, D2R };
});
