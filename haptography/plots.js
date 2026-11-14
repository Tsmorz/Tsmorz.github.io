// Time plots on canvas: traces decimated to one min/max column per pixel, so a minute of 16 kHz
// audio draws as fast as a second of it; bands (spans, strokes), markers, and an overlay for the
// playhead and a selection that redraws without the traces. Canvases get their size from CSS;
// only their pixel buffers are set here.

/** Colors from the page's CSS tokens, read again when the theme changes. */
export function readColors() {
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(name).trim();
  return {
    grid: v("--screen-grid"), line: v("--screen-line"), text: v("--screen-muted"), ink: v("--screen-text"),
    x: v("--series-x"), y: v("--series-y"), z: v("--series-z"), readout: v("--readout"),
    signal: v("--signal"), bad: v("--bad"), good: v("--good"), screen: v("--screen"),
    mono: v("--mono") || "monospace",
  };
}

function fit(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { w, h, dpr };
}

/** First index with t[i] >= x (t ascending). */
export function lowerBound(t, x, lo = 0, hi = t.length) {
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// A series' sample times: an array, or a uniform grid {t0, dt}.
function indexAt(series, x) {
  if (series.t) return lowerBound(series.t, x);
  return Math.max(0, Math.min(series.n, Math.ceil((x - series.t0) / series.dt)));
}
function timeAt(series, i) {
  return series.t ? series.t[i] : series.t0 + i * series.dt;
}
function valueAt(series, i) {
  return series.y[i * (series.stride ?? 1) + (series.offset ?? 0)] * (series.scale ?? 1);
}
function count(series) {
  return series.t ? series.t.length : series.n;
}

/** Nice tick step for a range spanning `span` with about `target` ticks. */
export function tickStep(span, target) {
  const raw = span / Math.max(1, target);
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

const fmtTick = (v, step) => {
  const digits = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return v.toFixed(Math.min(digits, 4));
};

export class Plot {
  /** @param {HTMLElement} box an element holding two canvases (traces and overlay) */
  constructor(box) {
    this.base = box.querySelector("canvas.base");
    this.over = box.querySelector("canvas.over");
    this.range = null;
  }

  /** Visible y range over [t0, t1): from the data, padded, or `fixed`. `symmetric` centres 0. */
  yRange(series, t0, t1, { fixed, symmetric, min = 1e-6 } = {}) {
    if (fixed) return fixed;
    let lo = Infinity, hi = -Infinity;
    for (const s of series) {
      const a = indexAt(s, t0), b = indexAt(s, t1);
      for (let i = a; i < b; i++) {
        const v = valueAt(s, i);
        if (!Number.isFinite(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (lo > hi) return symmetric ? [-1, 1] : [0, 1];
    if (symmetric) {
      const m = Math.max(Math.abs(lo), Math.abs(hi), min);
      return [-m * 1.1, m * 1.1];
    }
    const pad = Math.max((hi - lo) * 0.08, min);
    return [lo - pad, hi + pad];
  }

  /**
   * @param {{t0:number, t1:number, series:object[], colors:object, yOptions?:object,
   *   bands?:{t0:number,t1:number,color:string,label?:string}[], ticks?:{t:number,color:string}[],
   *   markers?:{t:number,label:string}[]}} o
   */
  draw(o) {
    const { w, h, dpr } = fit(this.base);
    const g = this.base.getContext("2d");
    g.clearRect(0, 0, w, h);
    const { t0, t1, colors } = o;
    const [y0, y1] = (this.range = this.yRange(o.series, t0, t1, o.yOptions));
    const X = (t) => ((t - t0) / (t1 - t0)) * w;
    const Y = (v) => h - ((v - y0) / (y1 - y0)) * h;
    this.map = { t0, t1, w, dpr };

    for (const b of o.bands ?? []) {
      if (b.t1 < t0 || b.t0 > t1) continue;
      g.fillStyle = b.color;
      const xa = Math.max(0, X(b.t0)), xb = Math.min(w, X(b.t1));
      g.fillRect(xa, 0, Math.max(1, xb - xa), h);
      if (b.label) {
        g.font = `${10 * dpr}px ${colors.mono}`;
        g.fillStyle = colors.ink;
        g.textBaseline = "top";
        g.save();
        g.beginPath();
        g.rect(xa, 0, xb - xa, h);
        g.clip();
        g.fillText(b.label, xa + 4 * dpr, 3 * dpr);
        g.restore();
      }
    }

    // Grid: y ticks with their values at the left, time ticks as vertical lines
    g.lineWidth = dpr;
    g.strokeStyle = colors.grid;
    g.fillStyle = colors.text;
    g.font = `${10 * dpr}px ${colors.mono}`;
    g.textBaseline = "middle";
    const ys = tickStep(y1 - y0, Math.max(2, Math.floor(h / (34 * dpr))));
    for (let v = Math.ceil(y0 / ys) * ys; v <= y1; v += ys) {
      const y = Math.round(Y(v)) + 0.5;
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
      if (y > 8 * dpr && y < h - 8 * dpr) g.fillText(fmtTick(v, ys), 4 * dpr, y);
    }
    const ts = tickStep(t1 - t0, Math.max(2, Math.floor(w / (90 * dpr))));
    for (let t = Math.ceil(t0 / ts) * ts; t <= t1; t += ts) {
      const x = Math.round(X(t)) + 0.5;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
    }
    if (y0 < 0 && y1 > 0) {
      g.strokeStyle = colors.line;
      const y = Math.round(Y(0)) + 0.5;
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
    }

    for (const s of o.series) this.trace(g, s, t0, t1, w, X, Y, dpr);

    for (const tick of o.ticks ?? []) {
      if (tick.t < t0 || tick.t > t1) continue;
      g.fillStyle = tick.color;
      g.fillRect(Math.round(X(tick.t)), h - 5 * dpr, Math.max(1, dpr), 5 * dpr);
    }
    for (const m of o.markers ?? []) {
      if (m.t < t0 || m.t > t1) continue;
      const x = Math.round(X(m.t)) + 0.5;
      g.strokeStyle = colors.signal;
      g.setLineDash([3 * dpr, 3 * dpr]);
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
      g.setLineDash([]);
      g.fillStyle = colors.signal;
      g.textBaseline = "bottom";
      g.fillText(m.label, x + 3 * dpr, h - 2 * dpr);
    }
  }

  trace(g, s, t0, t1, w, X, Y, dpr) {
    const n = count(s);
    if (!n) return;
    const a = Math.max(0, indexAt(s, t0) - 1);
    const b = Math.min(n, indexAt(s, t1) + 1);
    if (b - a < 1) return;
    g.strokeStyle = s.color;
    g.lineWidth = (s.width ?? 1.25) * dpr;
    g.lineJoin = "round";
    g.setLineDash((s.dash ?? []).map((v) => v * dpr));
    const perPixel = (b - a) / w;
    g.beginPath();
    if (perPixel < 3) {
      let pen = false;
      for (let i = a; i < b; i++) {
        const v = valueAt(s, i);
        if (!Number.isFinite(v)) { pen = false; continue; }
        const x = X(timeAt(s, i)), y = Y(v);
        if (pen) g.lineTo(x, y);
        else g.moveTo(x, y);
        pen = true;
      }
    } else {
      // One vertical stroke per pixel column from its min to its max, joined to the next
      let i = a;
      let pen = false;
      for (let px = 0; px < w && i < b; px++) {
        const end = Math.min(b, indexAt(s, t0 + ((px + 1) / w) * (t1 - t0)));
        let lo = Infinity, hi = -Infinity;
        for (; i < end; i++) {
          const v = valueAt(s, i);
          if (!Number.isFinite(v)) continue;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        if (lo > hi) { pen = false; continue; }
        const x = px + 0.5;
        if (pen) g.lineTo(x, Y(lo));
        else g.moveTo(x, Y(lo));
        g.lineTo(x, Y(hi));
        pen = true;
      }
    }
    g.stroke();
    g.setLineDash([]);
  }

  /** The overlay: a playhead, a hover line and a selection band, in the last draw's time map. */
  overlay({ playhead, hover, selection, colors }) {
    const { w, h, dpr } = fit(this.over);
    const g = this.over.getContext("2d");
    g.clearRect(0, 0, w, h);
    if (!this.map) return;
    const { t0, t1 } = this.map;
    const X = (t) => ((t - t0) / (t1 - t0)) * w;
    if (selection) {
      const xa = X(Math.min(selection[0], selection[1])), xb = X(Math.max(selection[0], selection[1]));
      g.fillStyle = colors.signal;
      g.globalAlpha = 0.16;
      g.fillRect(xa, 0, xb - xa, h);
      g.globalAlpha = 1;
      g.fillRect(Math.round(xa), 0, dpr, h);
      g.fillRect(Math.round(xb), 0, dpr, h);
      for (const x of [xa, xb]) g.fillRect(Math.round(x) - 3 * dpr, h / 2 - 12 * dpr, 6 * dpr, 24 * dpr);
    }
    if (hover !== null && hover !== undefined) {
      g.fillStyle = colors.line;
      g.fillRect(Math.round(X(hover)), 0, dpr, h);
    }
    if (playhead !== null && playhead !== undefined && playhead >= t0 && playhead <= t1) {
      g.fillStyle = colors.signal;
      g.fillRect(Math.round(X(playhead)) - dpr, 0, 2 * dpr, h);
    }
  }

  /** Time under a client x coordinate, in the last draw's map. */
  timeAtClientX(clientX) {
    if (!this.map) return null;
    const r = this.base.getBoundingClientRect();
    return this.map.t0 + ((clientX - r.left) / r.width) * (this.map.t1 - this.map.t0);
  }
}

/** The shared time axis under the plots: tick labels in seconds. */
export function drawAxis(canvas, t0, t1, colors, label = (t) => `${t} s`) {
  const { w, h, dpr } = fit(canvas);
  const g = canvas.getContext("2d");
  g.clearRect(0, 0, w, h);
  g.fillStyle = colors.text;
  g.font = `${10 * dpr}px ${colors.mono}`;
  g.textBaseline = "top";
  const ts = tickStep(t1 - t0, Math.max(2, Math.floor(w / (90 * dpr))));
  for (let t = Math.ceil(t0 / ts) * ts; t <= t1; t += ts) {
    const x = ((t - t0) / (t1 - t0)) * w;
    const text = label(fmtTick(t, ts));
    const tw = g.measureText(text).width;
    g.fillText(text, Math.min(w - tw, Math.max(0, x - tw / 2)), 2 * dpr);
  }
}

// ---- Frequency views -----------------------------------------------------------------------

function rgb(color) {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  const r = /rgba?\(([^)]+)\)/.exec(color);
  if (r) return r[1].split(",").slice(0, 3).map((v) => Number(v));
  return [128, 128, 128];
}

/** A 256-step ramp from the screen through the amber readout to the screen's ink, so loud is
 *  bright in the dark theme and dark in the light one. */
function ramp(colors) {
  const stops = [rgb(colors.screen), rgb(colors.readout), rgb(colors.ink)];
  const out = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const u = i / 255;
    const [a, b, k] = u < 0.6 ? [stops[0], stops[1], u / 0.6] : [stops[1], stops[2], (u - 0.6) / 0.4];
    for (let c = 0; c < 3; c++) out[i * 3 + c] = a[c] + (b[c] - a[c]) * k;
  }
  return out;
}

export const fmtHz = (f) => (f >= 1000 ? `${+(f / 1000).toFixed(f >= 10000 ? 0 : 1)}k` : `${+f.toFixed(0)}`);

/** Log-axis ticks (1, 2, 5 per decade) between lo and hi. */
export function logTicks(lo, hi) {
  const out = [];
  for (let d = Math.floor(Math.log10(lo)); d <= Math.ceil(Math.log10(hi)); d++) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** d;
      if (v >= lo && v <= hi) out.push(v);
    }
  }
  return out;
}

/**
 * A spectrogram on a time plot: frequency up, time across, sharing the plot's time map with its
 * overlay. sg: spectrogram() output; frameT(i): frame i's time (s); binHz; fmin..fmax shown,
 * log-spaced when `log`. dB from the loudest visible cell down `rangeDb`.
 */
Plot.prototype.drawSpectrogram = function (o) {
  const { w, h, dpr } = fit(this.base);
  const g = this.base.getContext("2d");
  const { t0, t1, sg, frameT, binHz, fmin, fmax, log, colors, rangeDb = 60 } = o;
  this.map = { t0, t1, w, dpr };
  const img = g.createImageData(w, h);
  const lut = ramp(colors);
  const [br, bgc, bb] = rgb(colors.screen);
  const rowBin = new Int32Array(h);
  for (let y = 0; y < h; y++) {
    const u = 1 - (y + 0.5) / h;
    const f = log ? fmin * (fmax / fmin) ** u : fmin + (fmax - fmin) * u;
    rowBin[y] = Math.min(sg.bins - 1, Math.max(0, Math.round(f / binHz)));
  }
  const step = sg.frames > 1 ? frameT(1) - frameT(0) : 1;
  const colFrame = new Int32Array(w);
  let hi = -Infinity;
  for (let x = 0; x < w; x++) {
    const t = t0 + ((x + 0.5) / w) * (t1 - t0);
    const f = Math.round((t - frameT(0)) / step);
    colFrame[x] = f >= 0 && f < sg.frames ? f : -1;
    if (colFrame[x] >= 0 && (x % 4 === 0)) {
      for (let y = 0; y < h; y += 4) hi = Math.max(hi, sg.db[colFrame[x] * sg.bins + rowBin[y]]);
    }
  }
  const lo = hi - rangeDb;
  const d = img.data;
  for (let x = 0; x < w; x++) {
    const f = colFrame[x];
    for (let y = 0; y < h; y++) {
      const p = (y * w + x) * 4;
      if (f < 0) { d[p] = br; d[p + 1] = bgc; d[p + 2] = bb; d[p + 3] = 255; continue; }
      const v = sg.db[f * sg.bins + rowBin[y]];
      const i = Math.max(0, Math.min(255, Math.round(((v - lo) / rangeDb) * 255))) * 3;
      d[p] = lut[i]; d[p + 1] = lut[i + 1]; d[p + 2] = lut[i + 2]; d[p + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // Frequency ticks
  g.font = `${10 * dpr}px ${colors.mono}`;
  g.textBaseline = "middle";
  const room = Math.max(2, Math.floor(h / (26 * dpr)));
  let ticks;
  if (log) ticks = logTicks(fmin, fmax);
  else {
    const st = tickStep(fmax - fmin, room);
    ticks = [];
    for (let f = Math.ceil(fmin / st) * st || st; f < fmax; f += st) ticks.push(f);
  }
  let lastY = Infinity;
  for (const f of ticks) {
    const u = log ? Math.log(f / fmin) / Math.log(fmax / fmin) : (f - fmin) / (fmax - fmin);
    const y = Math.round(h - u * h) + 0.5;
    if (y < 8 * dpr || y > h - 6 * dpr || lastY - y < 22 * dpr) continue;
    lastY = y;
    // On a backing of the screen's color, so a label stays readable over loud cells
    const text = `${fmtHz(f)} Hz`;
    const tw = g.measureText(text).width;
    g.globalAlpha = 0.75;
    g.fillStyle = colors.screen;
    g.fillRect(2 * dpr, y - 7 * dpr, tw + 6 * dpr, 14 * dpr);
    g.globalAlpha = 1;
    g.fillStyle = colors.text;
    g.fillText(text, 5 * dpr, y);
  }
  for (const b of o.bands ?? []) {
    if (b.t1 < t0 || b.t0 > t1 || !b.label) continue;
    const xa = Math.max(0, ((b.t0 - t0) / (t1 - t0)) * w), xb = Math.min(w, ((b.t1 - t0) / (t1 - t0)) * w);
    g.fillStyle = colors.line;
    g.fillRect(xa, 0, xb - xa, 2 * dpr);
  }
  this.range = [lo, hi];
};

/** An x-y plot for spectra (log frequency across) and the grain scatter. */
export class XYPlot {
  constructor(box) {
    this.base = box.querySelector("canvas.base");
    this.over = box.querySelector("canvas.over");
    this.map = null;
  }

  /**
   * @param {{x:[number,number], xLog?:boolean, y?:[number,number], yPad?:number, colors:object,
   *   series?:{x:ArrayLike<number>, y:ArrayLike<number>, color:string, width?:number, dash?:number[]}[],
   *   points?:{x:number, y:number, color:string}[], xFmt?:(v:number)=>string, yFmt?:(v:number)=>string,
   *   yFloorDb?:number}} o
   */
  draw(o) {
    const { w, h, dpr } = fit(this.base);
    const g = this.base.getContext("2d");
    g.clearRect(0, 0, w, h);
    const { colors } = o;
    const [x0, x1] = o.x;
    const series = o.series ?? [], points = o.points ?? [];
    let [y0, y1] = o.y ?? [Infinity, -Infinity];
    if (!o.y) {
      for (const s of series) for (let i = 0; i < s.x.length; i++) {
        if (s.x[i] < x0 || s.x[i] > x1 || !Number.isFinite(s.y[i])) continue;
        y0 = Math.min(y0, s.y[i]); y1 = Math.max(y1, s.y[i]);
      }
      for (const p of points) { y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
      if (!(y0 < y1)) { y0 = y0 === Infinity ? 0 : y0 - 1; y1 = y0 + 2; }
      // Spectra: show the top `yFloorDb` dB, so a deep floor doesn't flatten the shape
      if (o.yFloorDb) y0 = Math.max(y0, y1 - o.yFloorDb);
      const pad = (y1 - y0) * (o.yPad ?? 0.06);
      y0 -= pad; y1 += pad;
    }
    const X = o.xLog ? (v) => (Math.log(v / x0) / Math.log(x1 / x0)) * w : (v) => ((v - x0) / (x1 - x0)) * w;
    const Y = (v) => h - ((v - y0) / (y1 - y0)) * h;
    this.map = { x0, x1, y0, y1, xLog: o.xLog, w, h };

    for (const band of o.bands ?? []) {
      const a = X(Math.max(x0, band.x0)), b = X(Math.min(x1, band.x1));
      g.fillStyle = band.color;
      g.fillRect(a, 0, Math.max(0, b - a), h);
    }

    g.lineWidth = dpr;
    g.font = `${10 * dpr}px ${colors.mono}`;
    const xt = o.xLog ? logTicks(x0, x1) : (() => { const st = tickStep(x1 - x0, Math.max(2, Math.floor(w / (80 * dpr)))); const t = []; for (let v = Math.ceil(x0 / st) * st; v <= x1; v += st) t.push(v); return t; })();
    g.textBaseline = "bottom";
    for (const v of xt) {
      const x = Math.round(X(v)) + 0.5;
      g.strokeStyle = colors.grid;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
      const label = (o.xFmt ?? String)(v);
      const tw = g.measureText(label).width;
      g.fillStyle = colors.text;
      if (x > 2 * dpr && x < w - tw / 2) g.fillText(label, Math.min(w - tw - 2 * dpr, x + 3 * dpr), h - 2 * dpr);
    }
    const ys = tickStep(y1 - y0, Math.max(2, Math.floor(h / (30 * dpr))));
    g.textBaseline = "middle";
    for (let v = Math.ceil(y0 / ys) * ys; v <= y1; v += ys) {
      const y = Math.round(Y(v)) + 0.5;
      g.strokeStyle = colors.grid;
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
      if (y > 8 * dpr && y < h - 16 * dpr) {
        g.fillStyle = colors.text;
        g.fillText((o.yFmt ?? String)(+v.toFixed(6)), 4 * dpr, y);
      }
    }
    for (const s of series) {
      g.strokeStyle = s.color;
      g.lineWidth = (s.width ?? 1.5) * dpr;
      g.setLineDash((s.dash ?? []).map((d) => d * dpr));
      g.beginPath();
      let pen = false;
      for (let i = 0; i < s.x.length; i++) {
        const xv = s.x[i], yv = s.y[i];
        if (xv < x0 || xv > x1 || !Number.isFinite(yv) || (o.xLog && xv <= 0)) { pen = false; continue; }
        if (pen) g.lineTo(X(xv), Y(yv));
        else g.moveTo(X(xv), Y(yv));
        pen = true;
      }
      g.stroke();
    }
    g.setLineDash([]);
    for (const p of points) {
      g.fillStyle = p.color;
      g.beginPath();
      g.arc(X(p.x), Y(p.y), 3 * dpr, 0, 2 * Math.PI);
      g.fill();
    }
  }

  /** Data coordinates under a client point, or null. */
  valueAt(clientX, clientY) {
    if (!this.map) return null;
    const r = this.base.getBoundingClientRect();
    const u = (clientX - r.left) / r.width, v = 1 - (clientY - r.top) / r.height;
    const { x0, x1, y0, y1, xLog } = this.map;
    return { x: xLog ? x0 * (x1 / x0) ** u : x0 + u * (x1 - x0), y: y0 + v * (y1 - y0) };
  }

  /** A crosshair at a client point (or none). */
  overlay(point, colors) {
    const { w, h, dpr } = fit(this.over);
    const g = this.over.getContext("2d");
    g.clearRect(0, 0, w, h);
    if (!point) return;
    const r = this.over.getBoundingClientRect();
    const x = Math.round(((point.clientX - r.left) / r.width) * w) + 0.5;
    g.fillStyle = colors.line;
    g.fillRect(x, 0, dpr, h);
  }
}
