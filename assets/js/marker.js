// The highlighter on the home page headline. Each wrapped line gets its own hand-drawn stroke (an inline SVG behind the text), and
// every stroke differs: where it starts and stops, the slant of each end, how far it overshoots, wobble along both edges, a slight
// tilt, and its own ink-streak pattern. The color comes from --marker (translucent, so overlaps are darker), so both themes work. Without JS the CSS keeps
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

  // One line's highlight, w x h px: several overlapping pen passes. The ink is translucent, so wherever two passes cross it is darker,
  // at random places along the line (the pen going back over a word, or two strokes meeting mid-line), not just at the ends.
  function stroke(w, h, seed, i) {
    var rnd = rng(seed), r = function (a, b) { return a + (b - a) * rnd(); };
    var svg = el('svg', { width: w, height: h, viewBox: '0 0 ' + w + ' ' + h, 'aria-hidden': 'true' });
    svg.style.cssText = 'position:absolute;overflow:visible;transform:rotate(' + r(-0.5, 0.5).toFixed(2) + 'deg)';
    var topY = h * r(0.17, 0.23), botY = h * r(0.88, 0.95);

    // One pass from x = a to b: wobbly top and bottom edges (a point every ~40 px) and a chisel-tip slant at each end.
    function pass(a, b, dy) {
      var sa = r(-7, 9), sb = r(-9, 7), up = [], dn = [], x;
      for (x = a + 40; x < b - 20; x += 40) { up.push([x, topY + dy + r(-1.6, 1.6)]); dn.push([x, botY + dy + r(-1.6, 1.6)]); }
      var p = [[a + sa, topY + dy]].concat(up, [[b + sb, topY + dy + r(-1, 1)], [b - sb * 0.6, botY + dy]], dn.reverse(), [[a - sa * 0.6, botY + dy + r(-1, 1)]]);
      var d = el('path', { d: 'M' + p.map(function (q) { return q[0].toFixed(1) + ' ' + q[1].toFixed(1); }).join(' L') + ' Z' }, g);
      d.style.fill = 'var(--marker)';
    }

    var id = 'mk' + i, defs = el('defs', {}, svg), f = el('filter', { id: id, x: '-2%', y: '-10%', width: '104%', height: '120%', 'color-interpolation-filters': 'sRGB' }, defs);
    el('feTurbulence', { type: 'fractalNoise', baseFrequency: r(0.008, 0.016).toFixed(4) + ' ' + r(0.45, 0.7).toFixed(3), numOctaves: 2, seed: Math.floor(r(1, 200)), result: 'n' }, f);    // streaks
    el('feColorMatrix', { in: 'n', type: 'matrix', values: '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.6 0 0 0 0.42', result: 'a' }, f);
    el('feComposite', { in: 'SourceGraphic', in2: 'a', operator: 'in', result: 't' }, f);
    el('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.04 0.1', numOctaves: 2, seed: Math.floor(r(1, 200)), result: 'd' }, f);                                                    // ragged edges
    el('feDisplacementMap', { in: 't', in2: 'd', scale: r(4, 7).toFixed(1), xChannelSelector: 'R', yChannelSelector: 'G' }, f);
    var g = el('g', { filter: 'url(#' + id + ')' }, svg);

    var x0 = r(2, 11), x1 = w - r(2, 11), L = x1 - x0;
    if (L > 260 && rnd() < 0.35) {                                  // the line took two pen strokes, which meet (and overlap) somewhere in the middle
      var m = x0 + L * r(0.35, 0.65), ov = r(6, 22);
      pass(x0, m + ov, r(-0.8, 0.8)); pass(m - ov, x1, r(-0.8, 0.8));
    } else pass(x0, x1, 0);
    if (rnd() < 0.5) {                                             // sometimes the pen goes back over part of it
      var len = L * r(0.15, 0.35), a = x0 + (L - len) * rnd();
      pass(a, a + len, r(-2.5, 2.5));
    }
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
