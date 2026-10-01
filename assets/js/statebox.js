// State/units panel for the lower right of a sim canvas, shared by /controls/ and the swing-up page.
//
//   drawStateBox(ctx, W, H, [{ label: 'x', value: 0.123, decimals: 2, unit: 'm' }, ...])
//
// Integer parts are right-aligned and fractions left-aligned at one x, so the decimal points
// stack; the units sit in their own column just after the widest fraction.
(function () {
  'use strict';

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function isDark() {
    var t = document.documentElement.getAttribute('data-theme');
    return t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  window.drawStateBox = function (ctx, W, H, rows) {
    var LH = 14, PAD_X = 8, GAP = 6;
    ctx.save();
    ctx.font = '12px ' + css('--mono');
    var parts = rows.map(function (r) {
      var s = r.value.toFixed(r.decimals);
      if (/^-0(\.0+)?$/.test(s)) s = s.slice(1);              // no "-0.00"
      var dot = s.indexOf('.');
      return {
        label: r.label,
        int:   dot < 0 ? s : s.slice(0, dot),
        frac:  dot < 0 ? '' : s.slice(dot),
        unit:  r.unit || ''
      };
    });
    function widest(key) {
      return Math.max.apply(null, parts.map(function (p) { return ctx.measureText(p[key]).width; }));
    }
    var labelW = widest('label'), intW = widest('int'), fracW = widest('frac'), unitW = widest('unit');
    var bw = Math.ceil(PAD_X * 2 + labelW + GAP + intW + fracW + (unitW ? GAP + unitW : 0));
    var bh = rows.length * LH + 10;
    var bx = W - bw - 10, by = H - bh - 10;

    ctx.fillStyle = isDark() ? 'rgba(11,15,20,0.72)' : 'rgba(245,246,248,0.82)';
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 8); ctx.fill();
    ctx.strokeStyle = css('--border'); ctx.lineWidth = 1; ctx.stroke();

    var xLabel = bx + PAD_X;
    var xPoint = xLabel + labelW + GAP + intW;      // the decimal point column
    var xUnit  = xPoint + fracW + GAP;
    ctx.textBaseline = 'top';
    ctx.fillStyle = css('--text-muted');
    parts.forEach(function (p, i) {
      var y = by + 6 + i * LH;
      ctx.textAlign = 'left';  ctx.fillText(p.label, xLabel, y);
      ctx.textAlign = 'right'; ctx.fillText(p.int, xPoint, y);
      ctx.textAlign = 'left';  ctx.fillText(p.frac, xPoint, y);
      if (p.unit) ctx.fillText(p.unit, xUnit, y);
    });
    ctx.restore();
  };
})();
