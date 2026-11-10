// GlideCore: the maths behind /glide-reach/, with no DOM, so script/test-glide can run it in Node.
//   groundSpeed   ground speed along a straight track in steady wind
//   castRays      march rays out from the launch until the glide path (minus a margin) meets the terrain
//   reachAt       is a point (bearing, distance) inside the reachable set?
//   reachGrid     the same question by any route over a grid, so a glide can curve round a hill; routeTo walks it back
//   lonLatToPx / pxToLonLat / mppAt   Web Mercator pixels at a zoom
//   decodeTerrarium   one Terrarium RGB pixel to metres
//   chooseZoom    the terrain zoom that fits the whole possible glide
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

  // Tiles to save for an area centred on (lat, lon): the (2r+1)² block round the launch at zoom z, and the
  // (2rLow+1)² block round it at each lower zoom down to zMin. The page computes on a lower zoom when the glide could
  // reach past the zoom-z block, and draws its shaded map from these too.
  function areaTiles(lat, lon, z, r, zMin, rLow = r) {
    const out = [];
    for (let zz = z; zz >= zMin; zz--) {
      const [px, py] = lonLatToPx(lon, lat, zz), tx = Math.floor(px / TS), ty = Math.floor(py / TS), rr = zz === z ? r : rLow;
      for (let y = ty - rr; y <= ty + rr; y++) for (let x = tx - rr; x <= tx + rr; x++) out.push([zz, x, y]);
    }
    return out;
  }

  // The most detailed terrain zoom (zMax down to zMin) whose (2rt+1)² tile block, centred on the launch tile, still
  // holds a glide of `range` metres in every direction (the launch can sit anywhere in its tile, so rt tiles is the
  // guaranteed reach). A high launch over low ground gets coarser terrain instead of being cut off at the edge.
  function chooseZoom(range, lat, rt, zMax = 13, zMin = 9) {
    for (let z = zMax; z > zMin; z--) if (rt * TS * mppAt(lat, z) >= range * 1.05) return z;
    return zMin;
  }

  // Route search: the most height the glider can still have over each cell of a terrain grid, by any route, so a
  // glide can curve round a hill instead of stopping at it. Max-altitude Dijkstra over 16 neighbours (the 8 around a
  // cell plus the 8 knight's moves, so on flat ground the reach is within ~3% of a true circle). A step's height loss
  // is its length over the ground glide ratio in that direction, so wind is included; a step is allowed only if the
  // glider stays `margin` above the end cell and the cells it cuts between. Turns cost nothing extra here: for a model
  // glider a 180° turn loses a few metres, well inside a sensible margin.
  //   o: { cell (m), si, sj (start column and row; rows run south), h0, margin, Va, GR, windSpeed, windFromDeg }
  //   terr: Float32Array W×H of ground heights (NaN = no data, treated as a wall)
  // Returns alt (−Infinity where unreachable), parent (the previous cell on the best route, −1 at the start or
  // unreachable) and edge (true if a reachable cell touches the border, so the reach is cut short there).
  const MOVES = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
    [2, 1], [1, 2], [-1, 2], [-2, 1], [-2, -1], [-1, -2], [1, -2], [2, -1]];
  function reachGrid(o, terr, W, H) {
    const N = W * H, alt = new Float32Array(N).fill(-Infinity), parent = new Int32Array(N).fill(-1), done = new Uint8Array(N);
    const sink = o.Va / o.GR, wf = o.windFromDeg * D2R;
    const moves = MOVES.map(([dx, dy]) => {
      const vg = groundSpeed(Math.atan2(dx, -dy), o.Va, o.windSpeed, wf);
      const sx = Math.sign(dx), sy = Math.sign(dy);
      const mids = Math.abs(dx) === 2 ? [[sx, 0], [sx, sy]] : Math.abs(dy) === 2 ? [[0, sy], [sx, sy]] : dx && dy ? [[sx, 0], [0, sy]] : [];
      return { dx, dy, loss: vg > 0 ? Math.hypot(dx, dy) * o.cell * sink / vg : Infinity, mids };
    }).filter(m => m.loss < Infinity);
    let edge = false;
    const s = o.sj * W + o.si;
    if (o.si < 0 || o.sj < 0 || o.si >= W || o.sj >= H || !(o.h0 >= terr[s])) return { alt, parent, edge };
    // binary max-heap of (cell, height), lazy deletion
    let cap = 1 << 16, hi = new Int32Array(cap), hk = new Float32Array(cap), n = 0;
    const push = (i, k) => {
      if (n === cap) { cap *= 2; const a = new Int32Array(cap), b = new Float32Array(cap); a.set(hi); b.set(hk); hi = a; hk = b; }
      let c = n++;
      while (c > 0) { const p = (c - 1) >> 1; if (hk[p] >= k) break; hi[c] = hi[p]; hk[c] = hk[p]; c = p; }
      hi[c] = i; hk[c] = k;
    };
    const pop = () => {
      const top = hi[0], li = hi[--n], lk = hk[n];
      let c = 0;
      for (;;) {
        let ch = 2 * c + 1; if (ch >= n) break;
        if (ch + 1 < n && hk[ch + 1] > hk[ch]) ch++;
        if (hk[ch] <= lk) break;
        hi[c] = hi[ch]; hk[c] = hk[ch]; c = ch;
      }
      hi[c] = li; hk[c] = lk;
      return top;
    };
    alt[s] = o.h0; push(s, o.h0);
    while (n > 0) {
      const i = pop();
      if (done[i]) continue; // a stale or duplicate entry: the first pop of a cell is its best height
      done[i] = 1;
      const x = i % W, y = (i - x) / W, h = alt[i];
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
      for (const m of moves) {
        const nx = x + m.dx, ny = y + m.dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx, h2 = Math.fround(h - m.loss); // compare in float32, as stored
        if (done[j] || h2 <= alt[j] || !(h2 - o.margin >= terr[j])) continue;
        let ok = true;
        for (const [mx, my] of m.mids) if (!(h - m.loss / 2 - o.margin >= terr[(y + my) * W + x + mx])) { ok = false; break; }
        if (!ok) continue;
        alt[j] = h2; parent[j] = i; push(j, h2);
      }
    }
    return { alt, parent, edge };
  }

  // The best route to cell j as a list of cell indices from the start, or [] if j is unreachable.
  function routeTo(parent, alt, j) {
    if (!(alt[j] > -Infinity)) return [];
    const out = [];
    for (let i = j, guard = 0; i !== -1 && guard < parent.length; i = parent[i], guard++) out.push(i);
    return out.reverse();
  }

  // Keys in `area` that no area in `others` also uses.
  function tilesOnlyIn(area, others) {
    const keep = new Set();
    for (const o of others) for (const k of o) keep.add(k);
    return area.filter(k => !keep.has(k));
  }

  return { groundSpeed, castRays, reachAt, reachGrid, routeTo, chooseZoom, lonLatToPx, pxToLonLat, mppAt, decodeTerrarium, areaTiles, tilesOnlyIn, TS, D2R };
});
