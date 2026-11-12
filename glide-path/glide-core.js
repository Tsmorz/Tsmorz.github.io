// GlideCore: the maths behind /glide-path/, with no DOM, so script/test-glide can run it in Node.
//   groundSpeed   ground speed along a straight track in steady wind
//   castRays      march rays out from the launch until the glide path (minus a margin) meets the terrain
//   reachAt       is a point (bearing, distance) inside the reachable set?
//   glideAlong    one straight glide's height and the ground under it, for the cross-section
//   reachGrid     the same question by any route over a grid, so a glide can curve round a hill; routeTo walks it back
//   Units         metric and imperial read-outs
//   lonLatToPx / pxToLonLat / mppAt   Web Mercator pixels at a zoom
//   decodeTerrarium   one Terrarium RGB pixel to metres
//   chooseZoom    the terrain zoom that fits the whole possible glide
//   areaTiles     the terrain tiles a saved area needs, per zoom
//   tilesOnlyIn   which saved tiles can go when an area is deleted (ones no other area uses)
//   circle        points round a circle (the sight ring in 3D)
//   contours / contourStep   contour lines of a height grid (marching squares), and their spacing per zoom
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
      let last = 0, k = 1, h = o.h0;
      const dh = o.ds / g;
      for (let d = o.ds; d <= o.maxD; d += o.ds) {
        h -= dh;
        const t = elevAt(ux * d, uy * d);
        if (t !== t) { k = 1; break; }
        if (h - o.margin <= t) { k = 0; break; }
        last = d;
      }
      dmax[i] = last; kind[i] = k;
    }
    return { dmax, kind, grg, n };
  }

  // One straight glide along bearing brg (rad), step by step: distance, ground and glider height until it meets the
  // ground (or the data ends), then the ground on for `extra` metres more. Same rules as castRays.
  function glideAlong(o, elevAt, brg, extra = 0) {
    const vg = groundSpeed(brg, o.Va, o.windSpeed, o.windFromDeg * D2R), ux = Math.sin(brg), uy = Math.cos(brg);
    const d = [0], ground = [elevAt(0, 0)], glide = [o.h0];
    if (vg <= 0) return { d, ground, glide, end: 0, kind: 2, g: 0 };
    const g = vg / (o.Va / o.GR), dh = o.ds / g;
    let h = o.h0, kind = 1, end = 0, stopAt = Infinity;
    for (let s = o.ds; s <= o.maxD && s <= stopAt; s += o.ds) {
      const t = elevAt(ux * s, uy * s);
      if (t !== t) break;
      d.push(s); ground.push(t);
      if (stopAt === Infinity) {
        h -= dh;
        if (h - o.margin <= t) { kind = 0; glide.push(NaN); stopAt = s + extra; continue; }
        glide.push(h); end = d.length - 1;
      } else glide.push(NaN);
    }
    return { d, ground, glide, end, kind, g };
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
  //   o: { cell (m), si, sj (start column and row; rows run south), h0, margin, Va, GR, windSpeed, windFromDeg,
  //        maxR? (metres from the start the route must stay within) }
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
    const s = o.sj * W + o.si, r2 = o.maxR !== undefined ? (o.maxR / o.cell) ** 2 : Infinity;
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
        if ((nx - o.si) ** 2 + (ny - o.sj) ** 2 > r2) continue;
        const j = ny * W + nx;
        const h2 = Math.fround(h - m.loss); // compare in float32, as stored
        if (done[j] || !(h2 - o.margin >= terr[j])) continue;
        if (h2 <= alt[j]) continue;
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


  const FT = 3.28084, MPH = 2.23694, MI = 1609.344;
  // Read-outs in metric or imperial. Heights in m or ft; distances in m/km or ft/mi; speeds in m/s or mph; areas in km² or mi².
  const Units = {
    metric: {
      h: m => `${Math.round(m)} m`,
      d: m => m >= 10000 ? `${(m / 1000).toFixed(0)} km` : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`,
      v: ms => `${+ms.toFixed(1)} m/s`,
      a: km2 => `${km2.toFixed(1)} km²`
    },
    imperial: {
      h: m => `${Math.round(m * FT)} ft`,
      d: m => m >= 16 * MI ? `${(m / MI).toFixed(0)} mi` : m >= 0.2 * MI ? `${(m / MI).toFixed(1)} mi` : `${Math.round(m * FT)} ft`,
      v: ms => `${Math.round(ms * MPH)} mph`,
      a: km2 => `${(km2 / 2.589988).toFixed(1)} mi²`
    }
  };

  // Contour spacing for a map zoom, in metres: [interval, index] where every index-th line is drawn thicker.
  // Metric 200/100/50/20/10 m, imperial 500/250/200/80/40 ft, from zoom 10 and below to zoom 14 and above.
  const STEP = { metric: [200, 100, 50, 20, 10], imperial: [500, 250, 200, 80, 40] };
  function contourStep(z, units) {
    const i = Math.max(0, Math.min(4, Math.round(z) - 10));
    return units === 'imperial' ? [STEP.imperial[i] / FT, 5] : [STEP.metric[i], 5];
  }

  // Contour lines of a w × h height grid (row-major; a value is a pixel's centre, at integer coordinates), every `step`
  // metres. The grid is smoothed 3 × 3 first (edges clamped), so 30 m terrain doesn't draw saw teeth; marching squares
  // then runs on every cell between four centres, saddles split by the cell's mean. A cell touching a NaN draws nothing.
  // Returns { minor, major }: flat [x1, y1, x2, y2, ...] in grid coordinates; major holds every `index`-th level.
  // A window cut from a bigger grid draws the same lines, except within 2 px of the window's edge.
  function contours(g, w, h, step, index = 5) {
    const s = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let t = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const r = Math.min(h - 1, Math.max(0, y + dy)) * w;
        for (let dx = -1; dx <= 1; dx++) t += g[r + Math.min(w - 1, Math.max(0, x + dx))];
      }
      s[y * w + x] = t / 9; // NaN anywhere stays NaN
    }
    const minor = [], major = [];
    const cut = (a, b, L) => (L - a) / (b - a);
    for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
      const a = s[y * w + x], b = s[y * w + x + 1], c = s[(y + 1) * w + x + 1], d = s[(y + 1) * w + x];
      const lo = Math.min(a, b, c, d), hi = Math.max(a, b, c, d);
      if (!(hi > lo)) continue; // flat, or NaN
      for (let k = Math.floor(lo / step) + 1, kEnd = Math.floor(hi / step); k <= kEnd; k++) {
        const L = k * step;
        if (L <= lo) continue; // floor rounding at an exact multiple
        const out = k % index === 0 ? major : minor;
        // crossings on the edges: top a→b, right b→c, bottom d→c, left a→d
        const T = (a >= L) !== (b >= L) ? [x + cut(a, b, L), y] : null;
        const R = (b >= L) !== (c >= L) ? [x + 1, y + cut(b, c, L)] : null;
        const B = (d >= L) !== (c >= L) ? [x + cut(d, c, L), y + 1] : null;
        const Lf = (a >= L) !== (d >= L) ? [x, y + cut(a, d, L)] : null;
        const pts = [T, R, B, Lf].filter(Boolean);
        if (pts.length === 2) out.push(pts[0][0], pts[0][1], pts[1][0], pts[1][1]);
        else if (pts.length === 4) { // saddle: a and c on one side; join round whichever corners the centre agrees with
          const centreUp = (a + b + c + d) / 4 >= L;
          if (centreUp === (a >= L)) out.push(T[0], T[1], R[0], R[1], B[0], B[1], Lf[0], Lf[1]);
          else out.push(T[0], T[1], Lf[0], Lf[1], R[0], R[1], B[0], B[1]);
        }
      }
    }
    return { minor, major };
  }

  // n + 1 points [lat, lon] round a circle of r metres (closed: the last is the first), for drawing the sight ring.
  function circle(lat, lon, r, n = 64) {
    const R = 6371008.8, out = [];
    for (let i = 0; i <= n; i++) {
      const t = (i % n) / n * 2 * Math.PI;
      out.push([lat + r * Math.cos(t) / R / D2R, lon + r * Math.sin(t) / (R * Math.cos(lat * D2R)) / D2R]);
    }
    return out;
  }

  // Keys in `area` that no area in `others` also uses.
  function tilesOnlyIn(area, others) {
    const keep = new Set();
    for (const o of others) for (const k of o) keep.add(k);
    return area.filter(k => !keep.has(k));
  }

  return { groundSpeed, castRays, glideAlong, reachAt, reachGrid, routeTo, chooseZoom, Units, FT, MPH, MI, lonLatToPx, pxToLonLat, mppAt, decodeTerrarium, areaTiles, tilesOnlyIn, contours, contourStep, circle, TS, D2R };
});
