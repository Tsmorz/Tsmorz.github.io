// Theme toggle — remembers the choice, otherwise follows the OS setting.
(function () {
  var root = document.documentElement;
  var btn = document.querySelector('.theme-toggle');
  if (!btn) return;

  btn.addEventListener('click', function () {
    var current = root.getAttribute('data-theme');
    if (!current) {
      current = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    var next = current === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (e) {}
  });
})();

// Photo lightbox.
(function () {
  var shots = Array.prototype.slice.call(document.querySelectorAll('.shot'));
  if (!shots.length) return;

  var box = document.createElement('div');
  box.className = 'lightbox';
  box.innerHTML =
    '<button class="lightbox-close" type="button" aria-label="Close">&times;</button>' +
    '<div><img alt=""><p class="lightbox-cap"><strong></strong><span></span></p></div>';
  document.body.appendChild(box);

  var img = box.querySelector('img');
  var capTitle = box.querySelector('.lightbox-cap strong');
  var capMeta = box.querySelector('.lightbox-cap span');
  var lastFocus = null;

  function open(shot) {
    lastFocus = shot;
    img.src = shot.dataset.full;
    img.alt = shot.dataset.title || '';
    capTitle.textContent = shot.dataset.title || '';
    capMeta.textContent = shot.dataset.meta || '';
    box.setAttribute('open', '');
    box.querySelector('.lightbox-close').focus();
  }

  function close() {
    box.removeAttribute('open');
    img.src = '';
    if (lastFocus) lastFocus.focus();
  }

  shots.forEach(function (shot) {
    shot.addEventListener('click', function () { open(shot); });
    shot.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(shot); }
    });
  });

  box.addEventListener('click', function (e) {
    if (e.target === box || e.target.closest('.lightbox-close')) close();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && box.hasAttribute('open')) close();
  });
})();

// Hero field — math symbols that spring back to a home point, pushed by the cursor.
(function () {
  var hero = document.querySelector('.hero');
  var canvas = hero && hero.querySelector('.hero-field');
  if (!canvas) return;

  var ctx = canvas.getContext('2d');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var glyphs = [
    '∑', 'π', '∫', 'θ', 'λ', '√', '∞', 'Δ', '∂', 'ω',
    '∇', '±', '≈', '∮', '⊕', '≠', '∀', '∃', '⊥', 'φ'
  ];
  // A few full equations from the fields I work in, mixed in with the single symbols.
  var equations = [
    'ρ(∂v/∂t + v·∇v) = −∇p + μ∇²v', // Navier–Stokes
    'EI d⁴w/dx⁴ = q(x)', // Euler–Bernoulli beam
    'q̇ = J⁺(q) ẋ', // inverse kinematics (Jacobian pseudoinverse)
    'M(q)q̈ + C(q,q̇)q̇ + G(q) = τ' // manipulator dynamics
  ];
  var params = { K: 25, DAMPING_RATIO: 1.15, REPEL_R: 135, REPEL_STRENGTH: 240000, CURRENT_PUSH: 3, size: 18, count: 90 };

  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var w = 0, h = 0;
  var symbols = [];
  var t = 0;
  var last = 0;
  var rafId = null;
  var fieldColor = '#888';

  var mouseX = null, mouseY = null, mouseVX = 0, mouseVY = 0;
  var lastPX = null, lastPY = null, lastPT = null;
  var hasPointerEver = false;

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

  function readColor() {
    var styles = getComputedStyle(document.documentElement);
    fieldColor = styles.getPropertyValue('--text-muted').trim() || '#888';
  }

  function makeItem(text, isEquation) {
    var size = isEquation ? rand(params.size * 0.6, params.size * 0.72) : rand(params.size - 5, params.size + 5);
    // Margin is derived from the glyph's actual rendered width vs. the canvas
    // width, so it self-adjusts on narrow phone screens instead of relying on
    // a fixed fraction that clips long equations against the hero's edges.
    ctx.font = 'italic ' + size + "px 'STIX Two Text', 'Times New Roman', serif";
    var halfWidth = ctx.measureText(text).width / 2;
    var marginX = clamp((halfWidth + 12) / w, 0.05, 0.45);
    var marginY = 0.08;
    var hxr = marginX + Math.random() * (1 - marginX * 2);
    var hyr = marginY + Math.random() * (1 - marginY * 2);
    return {
      hxr: hxr, hyr: hyr,
      x: hxr * w, y: hyr * h,
      vx: 0, vy: 0,
      char: text,
      size: size,
      opacity: isEquation ? rand(0.22, 0.4) : rand(0.28, 0.6),
      seed: Math.random() * 1000
    };
  }

  function initSymbols() {
    symbols = [];
    var eqCount = Math.min(equations.length, params.count);
    var glyphCount = params.count - eqCount;
    var i;
    for (i = 0; i < eqCount; i++) symbols.push(makeItem(equations[i], true));
    for (i = 0; i < glyphCount; i++) symbols.push(makeItem(glyphs[i % glyphs.length], false));
  }

  function resize() {
    var rect = hero.getBoundingClientRect();
    w = rect.width; h = rect.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Only seed symbols once. Their home points are stored as fractions of
    // w/h, so later resizes (address-bar collapse, a web-font swap reflowing
    // the heading, orientation change) already retarget correctly without a
    // full re-randomize, which used to snap every symbol to a new spot and
    // read as a flash right after load.
    if (!symbols.length) initSymbols();
  }

  function onPointerMove(e) {
    var rect = hero.getBoundingClientRect();
    var x = e.clientX - rect.left, y = e.clientY - rect.top;
    var now = performance.now();
    if (lastPT !== null) {
      var dt = Math.max((now - lastPT) / 1000, 1 / 120);
      var ivx = (x - lastPX) / dt, ivy = (y - lastPY) / dt;
      mouseVX += (ivx - mouseVX) * 0.35;
      mouseVY += (ivy - mouseVY) * 0.35;
    }
    lastPX = x; lastPY = y; lastPT = now;
    mouseX = x; mouseY = y;
    hasPointerEver = true;
  }
  function onPointerLeave() { mouseX = mouseY = null; lastPT = null; }

  hero.addEventListener('pointermove', onPointerMove);
  hero.addEventListener('pointerleave', onPointerLeave);

  function update(dt) {
    t += dt;
    mouseVX *= 0.9; mouseVY *= 0.9;
    var C = 2 * Math.sqrt(params.K) * params.DAMPING_RATIO;
    for (var i = 0; i < symbols.length; i++) {
      var s = symbols[i];
      var hx = s.hxr * w, hy = s.hyr * h;
      var ax = -params.K * (s.x - hx) - C * s.vx;
      var ay = -params.K * (s.y - hy) - C * s.vy;
      if (mouseX !== null) {
        var dx = s.x - mouseX, dy = s.y - mouseY;
        var dist = Math.max(Math.hypot(dx, dy), 24);
        if (dist < params.REPEL_R) {
          var mag = params.REPEL_STRENGTH * (1 / dist - 1 / params.REPEL_R);
          var falloff = 1 - dist / params.REPEL_R;
          ax += (dx / dist) * mag + mouseVX * falloff * params.CURRENT_PUSH;
          ay += (dy / dist) * mag + mouseVY * falloff * params.CURRENT_PUSH;
        }
      }
      s.vx += ax * dt; s.vy += ay * dt;
      s.vx = clamp(s.vx, -2400, 2400); s.vy = clamp(s.vy, -2400, 2400);
      s.x += s.vx * dt; s.y += s.vy * dt;
    }
  }

  function render() {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = fieldColor;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (var i = 0; i < symbols.length; i++) {
      var s = symbols[i];
      ctx.globalAlpha = s.opacity;
      ctx.font = 'italic ' + s.size + "px 'STIX Two Text', 'Times New Roman', serif";
      var dx = 0, dy = 0;
      if (mouseX === null && !hasPointerEver) {
        dx = Math.sin(t * 0.6 + s.seed) * 4;
        dy = Math.cos(t * 0.5 + s.seed) * 4;
      }
      ctx.fillText(s.char, s.x + dx, s.y + dy);
    }
    ctx.globalAlpha = 1;
  }

  function tick(now) {
    var dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    update(dt);
    render();
    rafId = requestAnimationFrame(tick);
  }

  function start() {
    if (rafId || reduceMotion.matches) return;
    last = performance.now();
    rafId = requestAnimationFrame(tick);
  }
  function stop() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  }

  new ResizeObserver(resize).observe(hero);
  resize();

  var io = new IntersectionObserver(function (entries) {
    if (entries[0].isIntersecting) start(); else stop();
  });
  io.observe(hero);

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop(); else start();
  });

  new MutationObserver(readColor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readColor);
  readColor();

  if (reduceMotion.matches) {
    update(0);
    render();
  } else {
    start();
  }
})();
