// LabUI — drawing and panel helpers shared by the lab engines that came after lab.js (vision.js, embedded.js):
// theme colours, canvas sizing, text and lines, time-series plots, the panel's sliders, toggles, buttons and readouts,
// and pointer handling for the canvases. No lesson knowledge lives here.
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /* ---- colours and canvases ---- */
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function withAlpha(c, a) { var m = /^#([0-9a-f]{6})$/i.exec(c); if (!m) return c; var n = parseInt(m[1], 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; }
  function fmt(v, d) { var s = v.toFixed(d); return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s; }
  var col = {};
  function readColors() {
    var m = { text: '--text', muted: '--text-muted', border: '--border', accent: '--accent', bgSoft: '--bg-soft', bg: '--bg',
      viz1: '--viz-1', viz2: '--viz-2', viz3: '--viz-3', viz4: '--viz-4', bad: '--bad', mono: '--mono', font: '--font' };
    Object.keys(m).forEach(function (k) { col[k] = cssVar(m[k]); });
  }
  // Size the canvas's pixel buffer from its CSS box (never the other way round) and return a context in CSS pixels.
  function fit(canvas) {
    var dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
    var bw = Math.max(1, Math.round(W * dpr)), bh = Math.max(1, Math.round(H * dpr));
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    var ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    return { ctx: ctx, W: W, H: H };
  }

  /* ---- marks ---- */
  function text(ctx, s, x, y, color, o) {
    o = o || {};
    ctx.font = (o.w || '600') + ' ' + (o.size || 12) + 'px ' + (o.mono ? col.mono : col.font);
    ctx.fillStyle = color || col.text; ctx.textAlign = o.align || 'left'; ctx.textBaseline = o.base || 'top';
    ctx.fillText(s, x, y);
  }
  // A polyline; null or non-finite points break it.
  function line(ctx, pts, c, lw, dash) {
    ctx.strokeStyle = c; ctx.lineWidth = lw || 1.5; ctx.setLineDash(dash || []); ctx.beginPath();
    var on = false; pts.forEach(function (p) { if (!p || !isFinite(p[0]) || !isFinite(p[1])) { on = false; return; } if (on) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); on = true; });
    ctx.stroke(); ctx.setLineDash([]);
  }
  function ring(ctx, x, y, r, c, lw) { ctx.strokeStyle = c; ctx.lineWidth = lw || 2; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke(); }
  function cross(ctx, x, y, r, c, lw) { ctx.strokeStyle = c; ctx.lineWidth = lw || 2; ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); ctx.stroke(); }
  // White text on a dark tab, readable over any picture.
  function label(ctx, s, x, y, align) {
    ctx.font = '600 11px ' + col.font; var w = ctx.measureText(s).width, bx = align === 'right' ? x - w - 4 : x - 4;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(bx, y - 3, w + 8, 17);
    text(ctx, s, x, y, '#fff', { size: 11, align: align || 'left' });
  }
  function caption(c, s, sub) {
    text(c.ctx, s, 10, 8, col.text, { size: 12 });
    if (sub) text(c.ctx, sub, 10, 24, col.muted, { w: '400', size: 11 });
  }

  /* ---- plots ---- */
  function axes(c, x0, y0, x1, y1, yr, title, xlab) {
    var ctx = c.ctx;
    ctx.strokeStyle = col.border; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    if (yr[0] < 0 && yr[1] > 0) { var z = y1 - (0 - yr[0]) / (yr[1] - yr[0]) * (y1 - y0); line(ctx, [[x0, z], [x1, z]], col.border, 1, [3, 3]); }
    text(ctx, fmt(yr[1], Math.abs(yr[1]) < 10 ? 1 : 0), x0 - 4, y0, col.muted, { w: '400', size: 10, mono: true, align: 'right' });
    text(ctx, fmt(yr[0], Math.abs(yr[0]) < 10 ? 1 : 0), x0 - 4, y1 - 10, col.muted, { w: '400', size: 10, mono: true, align: 'right' });
    if (title) text(ctx, title, x0, y0 - 18, col.text, { size: 12 });
    if (xlab) text(ctx, xlab, x1, y1 + 4, col.muted, { w: '400', size: 10, align: 'right' });
    return function (i, n, v) { return [x0 + i / Math.max(1, n - 1) * (x1 - x0), y1 - (v - yr[0]) / (yr[1] - yr[0]) * (y1 - y0)]; };
  }
  function legend(ctx, items, x, y) {
    ctx.font = '500 11px ' + col.font;
    items.forEach(function (it) {
      ctx.fillStyle = it[1]; ctx.fillRect(x, y + 4, 12, 3); text(ctx, it[0], x + 16, y, col.muted, { w: '500', size: 11 });
      x += 24 + ctx.measureText(it[0]).width;
    });
  }
  // Lanes {v: values, c: colour, name, lw, dash} spread evenly across the plot's width.
  function series(c, lanes, yr, title, xlab) {
    var x0 = 44, y0 = 30, x1 = c.W - 12, y1 = c.H - 22, map = axes(c, x0, y0, x1, y1, yr, title, xlab);
    lanes.forEach(function (ln) { line(c.ctx, ln.v.map(function (v, i) { return isFinite(v) ? map(i, ln.v.length, clamp(v, yr[0], yr[1])) : null; }), ln.c, ln.lw || 1.6, ln.dash); });
    legend(c.ctx, lanes.filter(function (l) { return l.name; }).map(function (l) { return [l.name, l.c]; }), x0 + 4, y1 + 5);
    return { map: map, x0: x0, y0: y0, x1: x1, y1: y1 };
  }
  function range(arrs, minSpan) {
    var lo = Infinity, hi = -Infinity;
    arrs.forEach(function (a) { a.forEach(function (v) { if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }); });
    if (!isFinite(lo)) return [-1, 1];
    var mid = (lo + hi) / 2, span = Math.max(minSpan || 0.1, (hi - lo) * 1.15);
    return [mid - span / 2, mid + span / 2];
  }

  /* ---- panel controls ---- */
  function h3(panel, t) { panel.appendChild(el('h3', '', t)); }
  function hint(panel, t) { var p = el('p', 'panel-hint', t); panel.appendChild(p); return p; }
  var uid = 0;
  function slider(panel, lbl, min, max, step, value, fmtV, onInput) {
    var id = 'ui' + (uid++), g = el('div', 'pid-group'), lb = el('label'), val = el('span'); lb.setAttribute('for', id); lb.innerHTML = lbl + ' '; lb.appendChild(val);
    var inp = el('input'); inp.type = 'range'; inp.id = id; inp.min = min; inp.max = max; inp.step = step; inp.value = value;
    g.appendChild(lb); g.appendChild(inp); panel.appendChild(g);
    function show() { val.textContent = fmtV(parseFloat(inp.value)); }
    inp.addEventListener('input', function () { onInput(parseFloat(inp.value)); show(); }); show();
    return { input: inp, set: function (v) { inp.value = v; show(); } };
  }
  // A row of buttons, one pressed. Returns set(value) to press one from code.
  function toggle(panel, lbl, opts, current, onPick) {
    var box = el('div', 'mode-toggle'); box.setAttribute('role', 'group'); box.setAttribute('aria-label', lbl);
    function mark(val) { btns.forEach(function (x, i) { var on = opts[i][0] === val; x.classList.toggle('active', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); }); }
    var btns = opts.map(function (o) {
      var b = el('button', 'mode-btn', o[1]); b.type = 'button';
      b.addEventListener('click', function () { mark(o[0]); onPick(o[0]); });
      box.appendChild(b); return b;
    });
    mark(current); panel.appendChild(box);
    return mark;
  }
  function button(panel, lbl, onClick) { var b = el('button', 'sim-btn', lbl); b.type = 'button'; b.addEventListener('click', function () { onClick(b); }); panel.appendChild(b); return b; }
  function telemetry(panel, rows) {
    var t = el('div', 'telemetry'), vals = {};
    rows.forEach(function (r) { t.appendChild(el('span', 't-key', r[1])); vals[r[0]] = el('span', 't-val', '-'); t.appendChild(vals[r[0]]); });
    panel.appendChild(t); return vals;
  }
  function setV(span, v, bad) { if (!span) return; if (span.textContent !== v) span.textContent = v; span.classList.toggle('lab-bad', !!bad); }

  /* ---- pointer ---- */
  // A view says what a press on its canvas does by setting tab.hit[slot] = { box?, down(q, p) → drag(q, p) | null,
  // up?(), cursor?(q, p) }. q is in the box's image pixels when the view gave a box, else equal to p (canvas pixels).
  // tab.hover[slot] follows a mouse over the box (or a finger while it drags), for magnifiers.
  function bindPointer(canvas, tab, slot) {
    function at(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    function imgPt(h, p) { return { x: (p.x - h.box.x) / h.box.s, y: (p.y - h.box.y) / h.box.s }; }
    var drag = null, held = null;
    canvas.addEventListener('pointerdown', function (e) {
      var h = tab.hit[slot]; if (!h) return;
      var p = at(e), q = h.box ? imgPt(h, p) : p;
      drag = h.down ? h.down(q, p) : null; held = h;
      if (drag || h.up) { canvas.setPointerCapture(e.pointerId); e.preventDefault(); }
      if (drag) drag(q, p);
    });
    canvas.addEventListener('pointermove', function (e) {
      var h = tab.hit[slot]; if (!h) return;
      var p = at(e), q = h.box ? imgPt(h, p) : p;
      if (tab.hover) tab.hover[slot] = h.box && (e.pointerType === 'mouse' || drag) ? q : null;
      if (drag) drag(q, p); else canvas.style.cursor = h.cursor ? h.cursor(q, p) || '' : '';
    });
    function up(e) {
      drag = null; if (held && held.up) held.up(); held = null;
      if (tab.hover && e.pointerType !== 'mouse') tab.hover[slot] = null;
    }
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', function () { if (tab.hover) tab.hover[slot] = null; });
  }

  root.LabUI = {
    el: el, clamp: clamp, cssVar: cssVar, withAlpha: withAlpha, fmt: fmt, col: col, readColors: readColors, fit: fit,
    text: text, line: line, ring: ring, cross: cross, label: label, caption: caption,
    axes: axes, legend: legend, series: series, range: range,
    h3: h3, hint: hint, slider: slider, toggle: toggle, button: button, telemetry: telemetry, setV: setV, bindPointer: bindPointer
  };
})(typeof window !== 'undefined' ? window : this);
