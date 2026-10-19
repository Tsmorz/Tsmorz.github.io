// The highlighter on the home page headline. Each wrapped line gets its own hand-drawn stroke (an inline SVG behind the text), and
// every stroke differs: where it starts and stops, the slant of each end, how far it overshoots, wobble along both edges, a slight
// tilt, and its own ink-streak pattern. Colors come from --marker / --marker-deep, so both themes work. Without JS the CSS keeps
// a plain translucent background.
(function () {
  'use strict';
  var span = document.querySelector('.hero h1 .accent');
  if (!span) return;
  var h1 = span.parentNode, NS = 'http://www.w3.org/2000/svg';
  var base = (Math.random() * 1e9) | 0;          // new pen each visit, but stable across resizes

  function rng(seed) {                           // mulberry32
    var a = seed >>> 0;
    return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(e);
    return e;
  }

  // One stroke, w x h px. Edges are polylines with a little wobble every ~40 px; the ends are slanted like a chisel tip.
  function stroke(w, h, seed, i) {
    var r = function (a, b) { return a + (b - a) * rnd(); }, rnd = rng(seed);
    var svg = el('svg', { width: w, height: h, viewBox: '0 0 ' + w + ' ' + h, 'aria-hidden': 'true' });
    svg.style.cssText = 'position:absolute;overflow:visible;transform:rotate(' + r(-0.5, 0.5).toFixed(2) + 'deg)';
    var topY = h * r(0.17, 0.23), botY = h * r(0.88, 0.95);
    var x0 = r(2, 11), x1 = w - r(2, 11);
    var s0 = r(-7, 9), s1 = r(-9, 7);                              // end slants (px between the top and bottom corner)
    var n = Math.max(3, Math.round((x1 - x0) / 40)), top = [], bot = [];
    for (var k = 0; k <= n; k++) { top.push(r(-1.6, 1.6)); bot.push(r(-1.6, 1.6)); }
    function edge(a, y, wob, from, to, dir) {                      // points along an edge between two x positions
      var pts = [];
      for (var x = from; dir > 0 ? x < to : x > to; x += dir * 40) pts.push([x, y + wob[Math.min(n, Math.round((x - x0) / ((x1 - x0) / n)))]]);
      return pts;
    }
    function band(a, b, slantA, slantB) {                          // polygon between x = a and b
      var p = [[a + slantA, topY]].concat(edge(0, topY, top, a + 40, b - 20, 1), [[b + slantB, topY + r(-1, 1)], [b - slantB * 0.6, botY]], edge(0, botY, bot, b - 40, a + 20, -1), [[a - slantA * 0.6, botY + r(-1, 1)]]);
      return 'M' + p.map(function (q) { return q[0].toFixed(1) + ' ' + q[1].toFixed(1); }).join(' L') + ' Z';
    }
    var id = 'mk' + i, defs = el('defs', {}, svg), f = el('filter', { id: id, x: '-2%', y: '-10%', width: '104%', height: '120%', 'color-interpolation-filters': 'sRGB' }, defs);
    el('feTurbulence', { type: 'fractalNoise', baseFrequency: r(0.008, 0.016).toFixed(4) + ' ' + r(0.45, 0.7).toFixed(3), numOctaves: 2, seed: Math.floor(r(1, 200)), result: 'n' }, f);    // streaks
    el('feColorMatrix', { in: 'n', type: 'matrix', values: '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.6 0 0 0 0.42', result: 'a' }, f);
    el('feComposite', { in: 'SourceGraphic', in2: 'a', operator: 'in', result: 't' }, f);
    el('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.04 0.1', numOctaves: 2, seed: Math.floor(r(1, 200)), result: 'd' }, f);                                                    // ragged edges
    el('feDisplacementMap', { in: 't', in2: 'd', scale: r(4, 7).toFixed(1), xChannelSelector: 'R', yChannelSelector: 'G' }, f);
    var g = el('g', { filter: 'url(#' + id + ')' }, svg);
    var path = el('path', { d: band(x0, x1, s0, s1) }, g); path.style.fill = 'var(--marker)';
    var p0 = r(6, 16), p1 = r(5, 14);                                // ink pools where the pen touches down and lifts off
    var a = el('path', { d: band(x0, x0 + p0, s0, 0) }, g); a.style.fill = 'var(--marker-deep)';
    var b = el('path', { d: band(x1 - p1, x1, 0, s1) }, g); b.style.fill = 'var(--marker-deep)';
    return svg;
  }

  function draw() {
    var old = h1.querySelector('.marker-layer'); if (old) old.remove();
    var rects = Array.prototype.filter.call(span.getClientRects(), function (q) { return q.width > 8 && q.height > 8; });
    if (!rects.length) return;
    var hb = h1.getBoundingClientRect(), layer = document.createElement('span');
    layer.className = 'marker-layer'; layer.setAttribute('aria-hidden', 'true');
    rects.forEach(function (q, i) {
      var s = stroke(Math.round(q.width), Math.round(q.height), base + i * 7919, i);
      s.style.left = (q.left - hb.left) + 'px'; s.style.top = (q.top - hb.top) + 'px';
      layer.appendChild(s);
    });
    h1.insertBefore(layer, h1.firstChild);
    h1.classList.add('has-marker');
  }

  var timer;
  function later() { clearTimeout(timer); timer = setTimeout(draw, 80); }
  draw();
  window.addEventListener('resize', later);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);   // the headline font changes where lines break
})();
