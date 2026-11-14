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
//   gliderMesh    a sailplane as triangles, for the 3D fly-by
//   contours / contourStep   contour lines of a height grid (marching squares), and their spacing per zoom
(function (root, factory) {
  const core = factory(typeof module !== 'undefined' && module.exports ? require('./wind-core.js') : root.WindCore);
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  else root.GlideCore = core;
})(typeof self !== 'undefined' ? self : this, function (Wind) {
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

  // Va is true airspeed, including its vertical component (important for steep glides).
  function steadyGlide(Va, GR) {
    const horizontal = Va * GR / Math.hypot(GR, 1);
    return { horizontal, sink: Va / Math.hypot(GR, 1) };
  }
  function windSpeedAt(o, brg, e, n) {
    const Va = steadyGlide(o.Va, o.GR).horizontal;
    const v=o.windAt?o.windAt(e,n):o.wind?Wind.sampleLayer(o.wind,e,n):null;
    if(v){const x=Math.sin(brg),y=Math.cos(brg),along=v.east*x+v.north*y,cross=v.east*y-v.north*x;if(Math.abs(cross)>=Va)return 0;return Math.max(0,Math.sqrt(Va*Va-cross*cross)+along);}
    return groundSpeed(brg,Va,o.windSpeed,o.windFromDeg*D2R);
  }
  // Spatial wind is integrated step-by-step; uniform-wind callers retain their original exact path.
  function castRays(o, elevAt) {
    const n=o.n,sink=steadyGlide(o.Va,o.GR).sink,dmax=new Float32Array(n),kind=new Uint8Array(n),grg=new Float32Array(n),variable=!!(o.wind||o.windAt),profiles=variable?[]:null;
    for(let i=0;i<n;i++){
      const brg=i/n*2*Math.PI,ux=Math.sin(brg),uy=Math.cos(brg),vg=windSpeedAt(o,brg,0,0);
      if(vg<=0){kind[i]=2;if(profiles)profiles.push(new Float32Array([o.h0]));continue;}
      const g=vg/sink;grg[i]=g;let last=0,k=1,h=o.h0;const heights=variable?[h]:null;
      for(let d=o.ds;d<=o.maxD;d+=o.ds){
        const t=elevAt(ux*d,uy*d);if(!Number.isFinite(t)){k=1;break;}
        const speed=variable?windSpeedAt(o,brg,ux*(d-o.ds/2),uy*(d-o.ds/2)):vg;
        if(speed<=0){k=2;break;}
        h-=o.ds*sink/speed;
        if(h-o.margin<=t){k=0;break;}
        last=d;if(heights)heights.push(h);
      }
      dmax[i]=last;kind[i]=k;if(profiles)profiles.push(Float32Array.from(heights));
    }
    return {dmax,kind,grg,n,h0:o.h0,ds:o.ds,profiles};
  }
  function glideAlong(o,elevAt,brg,extra=0){
    const vg=windSpeedAt(o,brg,0,0),ux=Math.sin(brg),uy=Math.cos(brg),d=[0],ground=[elevAt(0,0)],glide=[o.h0];
    if(vg<=0)return {d,ground,glide,end:0,kind:2,g:0};
    const sink=steadyGlide(o.Va,o.GR).sink,g=vg/sink;let h=o.h0,kind=1,end=0,stopAt=Infinity;
    for(let s=o.ds;s<=o.maxD&&s<=stopAt;s+=o.ds){
      const t=elevAt(ux*s,uy*s);if(!Number.isFinite(t))break;d.push(s);ground.push(t);
      if(stopAt===Infinity){const speed=windSpeedAt(o,brg,ux*(s-o.ds/2),uy*(s-o.ds/2));
        if(speed<=0){kind=2;glide.push(NaN);stopAt=s+extra;continue;}
        h-=o.ds*sink/speed;if(h-o.margin<=t){kind=0;glide.push(NaN);stopAt=s+extra;continue;}
        glide.push(h);end=d.length-1;
      }else glide.push(NaN);
    }return {d,ground,glide,end,kind,g};
  }
  function reachAltitude(R,brg,dist){
    const f=((brg/(2*Math.PI)*R.n)%R.n+R.n)%R.n,i0=Math.floor(f),i1=(i0+1)%R.n;
    if(dist>Math.min(R.dmax[i0],R.dmax[i1]))return NaN;
    if(!R.profiles)return R.h0-dist/((R.grg[i0]+R.grg[i1])/2);
    const at=i=>{const p=R.profiles[i],x=dist/R.ds,k=Math.min(p.length-1,Math.floor(x)),j=Math.min(k+1,p.length-1);return p[k]+(p[j]-p[k])*(x-k);};
    return Math.min(at(i0),at(i1));
  }
  function reachAt(R,brg,dist){
    let f=brg/(2*Math.PI)*R.n;if(f<0)f+=R.n;const i0=Math.floor(f)%R.n,i1=(i0+1)%R.n;
    if(dist>Math.min(R.dmax[i0],R.dmax[i1]))return 0;
    if(!R.profiles)return (R.grg[i0]+R.grg[i1])/2;
    const h=reachAltitude(R,brg,dist);return dist>0&&R.h0>h?dist/(R.h0-h):(R.grg[i0]+R.grg[i1])/2;
  }

  // Plan extra drag at constant true airspeed, never an instantaneous altitude snap.
  // The supplied best-glide profile already includes wind and the route's terrain checks.
  // Backward viability + forward maximum descent finds the lowest feasible arrival on this track.
  // This is quasi-steady planning: no flare, acceleration, stall or finite-radius turn model.
  function descentPath(o) {
    const { d, ground, best, bearing, wind, Va, GR, margin, maxSink } = o;
    const n = d.length, h = best.slice(), time = Array(n).fill(0), sink = Array(n).fill(0);
    if (n < 2 || !d.every(Number.isFinite) || !ground.every(Number.isFinite) || !best.every(Number.isFinite)) return { h, time, sink, state: 'missing' };
    const base = steadyGlide(Va, GR), limit = Math.max(base.sink, Math.min(maxSink, Va * 0.8));
    const low = [], high = [], floor = ground.map(g => g + margin);
    for (let k = 1; k < n; k++) {
      const ds = d[k] - d[k-1], v = wind[k-1], brg = bearing[k-1];
      if (!(ds > 0)) return { h, time, sink, state: 'invalid' };
      low[k] = Math.max(0, best[k-1] - best[k]);
      const loss = w => {
        const speed = groundSpeed(brg, Math.sqrt(Va*Va-w*w), Math.hypot(v.east,v.north), Math.atan2(-v.east,-v.north));
        return speed > 0 ? ds*w/speed : Infinity;
      };
      // Limit extra sink before cross/headwind removes forward progress.
      let a = base.sink, b = limit;
      for (let j=0;j<40;j++) { const m=(a+b)/2; if (Number.isFinite(loss(m))) a=m; else b=m; }
      high[k] = Math.max(low[k], loss(a));
    }
    for (let k=n-2;k>=0;k--) floor[k]=Math.max(floor[k],floor[k+1]+low[k+1]);
    if (floor[0] > best[0]+0.02) return { h, time, sink, state: 'blocked' };
    for (let k=1;k<n;k++) {
      h[k] = Math.min(best[k], Math.max(floor[k],h[k-1]-high[k]));
      const ds=d[k]-d[k-1], slope=(h[k-1]-h[k])/ds, v=wind[k-1], brg=bearing[k-1];
      const along=v.east*Math.sin(brg)+v.north*Math.cos(brg), cross=v.east*Math.cos(brg)-v.north*Math.sin(brg);
      // Solve Va² = (Vground − Walong)² + Wcross² + (slope·Vground)².
      const A=1+slope*slope, disc=A*(Va*Va-cross*cross)-slope*slope*along*along;
      const vg=(along+Math.sqrt(Math.max(0,disc)))/A;
      if (!(vg>0)) return { h: best.slice(), time, sink, state: 'blocked' };
      sink[k]=slope*vg; time[k]=time[k-1]+ds/vg;
    }
    return { h, time, sink, state: h[n-1]-ground[n-1] <= margin+0.05 ? 'approach' : 'limited' };
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
    const N = W * H, alt = new Float32Array(N).fill(-Infinity), parent = new Int32Array(N).fill(-1), midAlt = new Float32Array(N).fill(NaN), done = new Uint8Array(N);
    const { sink, horizontal } = steadyGlide(o.Va, o.GR), wf = o.windFromDeg * D2R;
    const variable=!!o.wind;
    const moves = MOVES.map(([dx, dy]) => {
      const vg = groundSpeed(Math.atan2(dx, -dy), horizontal, o.windSpeed, wf);
      const sx = Math.sign(dx), sy = Math.sign(dy);
      const mids = Math.abs(dx) === 2 ? [[sx, 0], [sx, sy]] : Math.abs(dy) === 2 ? [[0, sy], [sx, sy]] : dx && dy ? [[sx, 0], [0, sy]] : [];
      return { dx, dy, brg: Math.atan2(dx,-dy), length: Math.hypot(dx,dy)*o.cell, loss: vg > 0 ? Math.hypot(dx, dy) * o.cell * sink / vg : Infinity, mids };
    }).filter(m => variable || m.loss < Infinity);
    let edge = false;
    const s = o.sj * W + o.si, r2 = o.maxR !== undefined ? (o.maxR / o.cell) ** 2 : Infinity;
    if (o.si < 0 || o.sj < 0 || o.si >= W || o.sj >= H || !(o.h0 >= terr[s])) return { alt, parent, midAlt, edge };
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
        let loss=m.loss,firstLoss=m.loss/2;
        if(variable){
          const speed=t=>windSpeedAt(o,m.brg,(x-o.si+m.dx*t)*o.cell,(o.sj-y-m.dy*t)*o.cell);
          const a=speed(.25),b=speed(.75);if(a<=0||b<=0||speed(0)<=0||speed(1)<=0)continue;
          firstLoss=m.length*.5*sink/a;loss=firstLoss+m.length*.5*sink/b;
        }
        const h2 = Math.fround(h - loss); // compare in float32, as stored
        if (done[j] || !(h2 - o.margin >= terr[j])) continue;
        if (h2 <= alt[j]) continue;
        let ok = true;
        for (const [mx, my] of m.mids) if (!(h - firstLoss - o.margin >= terr[(y + my) * W + x + mx])) { ok = false; break; }
        if (!ok) continue;
        alt[j] = h2; midAlt[j]=h-firstLoss; parent[j] = i; push(j, h2);
      }
    }
    return { alt, parent, midAlt, edge };
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

  // A 2 m model sailplane as a triangle mesh, for the 3D fly-by. Metres; z forward (the nose), y up, x to the left (so the
  // pilot's right wing is at −x); the origin is the wing's quarter chord at the root. A slim fuselage lofted through
  // superellipse sections with a painted canopy, tapered wings with a thin cambered airfoil and polyhedral, and a T-tail;
  // red tips. Proportions of a model, not a scaled-down full-size glider: a shorter wing for its fuselage, a bigger tail.
  // Returns { pos, nrm, col } (Float32Array, 3 per vertex: position, unit normal pointing out, linear RGB) and idx (Uint16Array).
  // Calibrate the chase distance to the same 2 m mesh and CSS-sized glider viewport.
  // Both cameras then project a metre to the same number of screen pixels.
  const FLIGHT_VIEW = { fov: 17, distance: 2.15, look: 28 };
  function flightCamera(span, gliderHeight, mapHeight, mapFov) {
    const distance = FLIGHT_VIEW.distance * span * mapHeight / gliderHeight *
      Math.tan(FLIGHT_VIEW.fov * D2R / 2) / Math.tan(mapFov * D2R / 2);
    return { distance, back: distance * Math.cos(FLIGHT_VIEW.look * D2R),
      up: distance * Math.sin(FLIGHT_VIEW.look * D2R), clearance: Math.min(1, span / 2) };
  }

  function gliderMesh() {
    const pos = [], nrm = [], col = [], idx = [];
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const unit = a => { const l = Math.hypot(a[0], a[1], a[2]); return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : null; };
    const WHITE = [0.93, 0.93, 0.92], GLASS = [0.05, 0.07, 0.10], TIP = [0.80, 0.08, 0.10];
    // a grid of rows × cols points; normals from the neighbours, turned to face away from each row's centre
    function grid(P, centre, colour, wrap, fallback) {
      const rows = P.length, cols = P[0].length, base = pos.length / 3, cl = c => wrap ? (c + cols) % cols : Math.min(cols - 1, Math.max(0, c));
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const p = P[r][c], o = centre(r);
        let n = unit(cross(sub(P[Math.min(rows - 1, r + 1)][c], P[Math.max(0, r - 1)][c]), sub(P[r][cl(c + 1)], P[r][cl(c - 1)])))
          || unit(sub(p, o)) || fallback(r);
        if (dot(n, sub(p, o)) < 0) n = [-n[0], -n[1], -n[2]];
        pos.push(...p); nrm.push(...n); col.push(...colour(r, c));
      }
      for (let r = 0; r < rows - 1; r++) for (let c = 0; c < (wrap ? cols : cols - 1); c++) {
        const a = base + r * cols + c, b = base + r * cols + cl(c + 1), d = a + cols, e = b + cols;
        idx.push(a, d, b, b, d, e);
      }
    }
    // Catmull–Rom through stations [x, ...values]
    function spline(S, x) {
      let k = 0; while (k < S.length - 2 && S[k + 1][0] < x) k++;
      const p0 = S[Math.max(0, k - 1)], p1 = S[k], p2 = S[k + 1], p3 = S[Math.min(S.length - 1, k + 2)], t = (x - p1[0]) / (p2[0] - p1[0]);
      return p1.map((_, i) => i === 0 ? x : 0.5 * (2 * p1[i] + (-p0[i] + p2[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t * t +
        (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t * t * t));
    }

    // fuselage: z, half width, half height, centre height
    const FUS = [[-.80, .008, .012, .006], [-.70, .010, .015, .005], [-.45, .014, .019, .001], [-.20, .022, .028, -.003], [-.03, .034, .042, -.006],
                 [.10, .037, .046, -.008], [.22, .034, .041, -.011], [.30, .025, .029, -.014], [.345, .012, .014, -.017], [.36, .003, .003, -.019]];
    const NZ = 56, NA = 32, P = [], cen = [];
    for (let r = 0; r < NZ; r++) {
      const z = -.80 + (.36 + .80) * r / (NZ - 1), [, w, h, cy] = spline(FUS, z), row = [];
      for (let a = 0; a < NA; a++) {
        const t = a / NA * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t), e = 2 / 2.4; // a superellipse, a little fuller than an ellipse
        row.push([w * Math.sign(c) * Math.abs(c) ** e, cy + h * Math.sign(s) * Math.abs(s) ** e, z]);
      }
      P.push(row); cen.push([0, cy, z]);
    }
    grid(P, r => cen[r], () => WHITE, true, r => [0, 0, r ? 1 : -1]);

    // canopy: the top of an ellipsoid over the cockpit
    const C = [], CN = 22, CA = 14, cc = [0, .018, .17], ax = [.028, .034, .11];
    for (let r = 0; r < CN; r++) {
      const u = -0.97 + 1.94 * r / (CN - 1), k = Math.sqrt(1 - u * u), row = [];
      for (let a = 0; a < CA; a++) { const t = a / (CA - 1) * Math.PI; row.push([cc[0] + ax[0] * k * Math.cos(t), cc[1] + ax[1] * k * Math.sin(t), cc[2] + ax[2] * u]); }
      C.push(row);
    }
    grid(C, () => [cc[0], cc[1] - 0.025, cc[2]], () => GLASS, false, () => [0, 1, 0]);

    // a lifting surface through stations { le: leading edge, c: chord, up: thickness direction, tau, camber, colour }
    const NC = 28;
    function surface(st, capOut) {
      const Q = [];
      for (const s of st) {
        const row = [];
        for (let i = 0; i < NC; i++) {
          const th = i / NC * 2 * Math.PI, x = (1 + Math.cos(th)) / 2, upper = Math.sin(th) >= 0;
          const yt = 5 * s.tau * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
          const y = (s.camber * 4 * x * (1 - x) + (upper ? yt : -yt)) * s.c;
          row.push([s.le[0] + s.up[0] * y, s.le[1] + s.up[1] * y, s.le[2] - x * s.c + s.up[2] * y]);
        }
        Q.push(row);
      }
      grid(Q, r => [st[r].le[0], st[r].le[1], st[r].le[2] - st[r].c * 0.4], r => st[r].colour, true, () => st[0].up);
      // close the outer end
      const last = Q[Q.length - 1], s = st[st.length - 1], base = pos.length / 3;
      pos.push(s.le[0], s.le[1], s.le[2] - s.c * 0.4); nrm.push(...capOut); col.push(...s.colour);
      for (const p of last) { pos.push(...p); nrm.push(...capOut); col.push(...s.colour); }
      for (let i = 0; i < NC; i++) idx.push(base, base + 1 + i, base + 1 + (i + 1) % NC);
    }
    const HALF = 1.0, D1 = Math.tan(3 * D2R), D2 = Math.tan(9 * D2R), KINK = 0.6; // 2 m span; polyhedral from 60 cm out
    for (const side of [1, -1]) {
      const st = [];
      for (let j = 0; j <= 30; j++) {
        const e = j / 30, x = 0.03 + e * (HALF - 0.03);
        const c = e < 0.5 ? 0.21 - 0.025 * e / 0.5 : e < 0.86 ? 0.185 - 0.05 * (e - 0.5) / 0.36 : 0.135 - 0.045 * (e - 0.86) / 0.14;
        const y = 0.035 + Math.min(x, KINK) * D1 + Math.max(0, x - KINK) * D2;
        st.push({ le: [side * x, y, 0.25 * c], c, up: [0, 1, 0], tau: 0.095 - 0.015 * e, camber: 0.03, colour: e > 0.92 ? TIP : WHITE });
      }
      surface(st, [side, 0, 0]);
      const tail = [];
      for (let j = 0; j <= 9; j++) {
        const e = j / 9, c = 0.10 - 0.035 * e;
        tail.push({ le: [side * e * 0.21, 0.19, -0.715 + 0.25 * c], c, up: [0, 1, 0], tau: 0.09, camber: 0, colour: e > 0.75 ? TIP : WHITE });
      }
      surface(tail, [side, 0, 0]);
    }
    const fin = [];
    for (let j = 0; j <= 11; j++) {
      const e = j / 11, c = 0.16 - 0.07 * e, te = -0.83 + 0.01 * e;
      fin.push({ le: [0, 0.004 + e * 0.186, te + c], c, up: [1, 0, 0], tau: 0.09, camber: 0, colour: e > 0.8 ? TIP : WHITE });
    }
    surface(fin, [0, 1, 0]);
    return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), col: new Float32Array(col), idx: new Uint16Array(idx) };
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

  return { steadyGlide, descentPath, groundSpeed, castRays, glideAlong, reachAt, reachAltitude, reachGrid, routeTo, chooseZoom, Units, FT, MPH, MI, lonLatToPx, pxToLonLat, mppAt, decodeTerrarium, areaTiles, tilesOnlyIn, contours, contourStep, circle, gliderMesh, flightCamera, FLIGHT_VIEW, TS, D2R };
});
