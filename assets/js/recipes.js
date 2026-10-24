// RecipeCore + the /recipes/ page. Every amount in _data/recipes.yml is a weight in grams, so the recipes run on a
// kitchen scale; RecipeCore turns grams, °C, cm and mL into the visitor's units. It has no DOM, so script/test-recipes
// can load it in Node. The page keeps the unit choice, each recipe's scale and the ticked boxes in localStorage.
// Scaling multiplies every ingredient, spoon measure and [[i:]], [[n:]], [[gx:]] or [[mlx:]] token; [[g:]], [[ml:]], [[t:]] and [[len:]]
// are per piece (a ball of dough, a ramekin, the oven) and stay put.
(function (root) {
  'use strict';

  var OZ = 28.349523125, FLOZ = 29.5735295625, GAL = 3785.411784;

  function num(x, d) { var p = Math.pow(10, d || 0); return String(Math.round(x * p) / p); }

  // Metric: grams, then kilograms. Imperial: decimal ounces (what a scale shows), then pounds and ounces.
  function mass(g, unit) {
    if (unit !== 'imperial') return g >= 1000 ? num(g / 1000, 2) + ' kg' : num(g, g < 10 ? 1 : 0) + ' g';
    var oz = g / OZ, o1 = Math.round(oz * 10) / 10;
    if (o1 >= 16) {
      var lb = Math.floor(o1 / 16), r = Math.round((o1 - lb * 16) * 10) / 10;
      return lb + ' lb' + (r ? ' ' + num(r, 1) + ' oz' : '');
    }
    return num(oz, oz < 1 ? 2 : 1) + ' oz';
  }

  // US ovens dial in 25 °F steps (175 °C is "350"), a thermometer reads to 5, and below 60 °C (fridge, room, tea) a degree matters.
  function temp(c, unit) {
    if (unit !== 'imperial') return num(c, 0) + ' °C';
    var f = c * 9 / 5 + 32, step = c >= 120 ? 25 : c >= 60 ? 5 : 1;
    return Math.round(f / step) * step + ' °F';
  }

  function length(cm, unit) { return unit !== 'imperial' ? num(cm, 0) + ' cm' : num(cm / 2.54 * 2, 0) / 2 + ' in'; }

  function volume(ml, unit) {
    if (unit !== 'imperial') return ml >= 1000 ? num(ml / 1000, 2) + ' L' : num(ml, 0) + ' mL';
    return ml >= 3000 ? num(Math.round(ml / GAL * 4) / 4, 2) + ' gal' : num(ml / FLOZ, 0) + ' fl oz';
  }

  // A count or spoon measure in kitchen fractions: 2.5 -> "2½", 0.75 -> "¾"; anything under a sixteenth is "0".
  var FRACS = [[0, ''], [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'], [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞'], [1, '']];
  function frac(x) {
    if (x >= 10) return String(Math.round(x));
    var whole = Math.floor(x), best = FRACS[0];
    FRACS.forEach(function (f) { if (Math.abs(x - whole - f[0]) < Math.abs(x - whole - best[0])) best = f; });
    if (best[0] === 1) { whole++; best = FRACS[0]; }
    return (whole || !best[1] ? String(whole) : '') + best[1];
  }

  // "1¼ tsp" times 2 -> "2½ tsp". Text with no leading number is left alone.
  var LEAD = /^(\d+(?:\.\d+)?)?\s*([⅛¼⅓⅜½⅝⅔¾⅞])?/;
  function spoon(text, scale) {
    var m = LEAD.exec(text || ''), s = scale || 1;
    if (!m[0] || s === 1) return text;
    var v = (m[1] ? Number(m[1]) : 0) + (m[2] ? FRACS.filter(function (f) { return f[1] === m[2]; })[0][0] : 0), out = frac(v * s);
    return out === '0' ? 'a pinch' : out + text.slice(m[0].length).replace(/^(?=\S)/, ' ');
  }

  var UNITS = { g: mass, t: temp, len: length, ml: volume };
  var SCALED = { n: frac, gx: mass, mlx: volume };
  var TOKEN = /\[\[(\w+):([^\]]*)\]\]/g;

  // "Heat to [[t:175]]." -> [{ text: 'Heat to ' }, { kind: 't', arg: '175' }, { text: '.' }]
  function split(text) {
    var out = [], last = 0, m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(text))) {
      if (m.index > last) out.push({ text: text.slice(last, m.index) });
      out.push({ kind: m[1], arg: m[2] });
      last = TOKEN.lastIndex;
    }
    if (last < text.length) out.push({ text: text.slice(last) });
    return out;
  }

  // The amount of an ingredient at a scale: its weight, or its `qty` text (which may hold an [[n:]] count) when it can't be weighed.
  function amount(item, unit, scale) {
    return item.g != null ? mass(item.g * (scale || 1), unit) : render(String(item.qty || ''), unit, null, scale);
  }

  // One token as text. `find(id)` returns an ingredient (for [[i:id]]); a range "22-26" shares one unit: "22–26 °C".
  // [[n:4]] is a count and [[gx:]], [[mlx:]] are grams and mL, all multiplied by the scale.
  function convert(kind, arg, unit, find, scale) {
    var s = scale || 1;
    if (kind === 'i') { var it = find && find(arg); return it ? amount(it, unit, s) : null; }
    var f = UNITS[kind] || SCALED[kind], x = SCALED[kind] ? s : 1, m = /^(-?[\d.]+)(?:-([\d.]+))?$/.exec(arg.trim());
    if (!f || !m) return null;
    var a = f(Number(m[1]) * x, unit);
    if (m[2] === undefined) return a;
    var b = f(Number(m[2]) * x, unit), ua = /\s(\S+)$/.exec(a), ub = /\s(\S+)$/.exec(b);
    return (ua && ub && ua[1] === ub[1] ? a.slice(0, a.length - ua[0].length) : a) + '–' + b;
  }

  // A whole string with its tokens replaced; an unknown token stays visible as "?" so a typo shows up in the tests.
  function render(text, unit, find, scale) {
    return split(text).map(function (p) {
      if (p.text !== undefined) return p.text;
      var v = convert(p.kind, p.arg, unit, find, scale);
      return v === null ? '?' : v;
    }).join('');
  }

  function find(recipe, id) {
    for (var g = 0; g < recipe.ingredients.length; g++) {
      var items = recipe.ingredients[g].items;
      for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
    }
    return null;
  }

  var RecipeCore = { mass: mass, temp: temp, length: length, volume: volume, frac: frac, spoon: spoon, split: split, amount: amount, convert: convert, render: render, find: find, GRAMS_PER_OZ: OZ };
  if (typeof module !== 'undefined' && module.exports) module.exports = RecipeCore;
  root.RecipeCore = RecipeCore;

  // ---- the page ----
  if (typeof document === 'undefined') return;
  var view = document.getElementById('rc-view'), dataEl = document.getElementById('rc-data');
  if (!view || !dataEl) return;

  var recipes = JSON.parse(dataEl.textContent);
  var KEY = 'recipes';
  var state = { unit: 'metric', checks: {}, scale: {} };
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (saved.unit === 'imperial') state.unit = 'imperial';
    if (saved.checks) state.checks = saved.checks;
    if (saved.scale) state.scale = saved.scale;
  } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

  var current = null, page = view.closest('.journal'), title = document.title;   // null: the index, no recipe open
  var bar = document.querySelector('.rc-bar');   // the scale, units and clear-ticks bar: build() moves it under the recipe's head
  function scaleOf(r) { var s = Number(state.scale[r.id]); return s > 0 ? s : 1; }
  function fromHash() {
    var id = decodeURIComponent(location.hash.replace(/^#/, ''));
    return recipes.filter(function (r) { return r.id === id; })[0] || null;
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  // Text with its converted amounts picked out in the mono face.
  function rich(parent, text, recipe) {
    split(text).forEach(function (p) {
      if (p.text !== undefined) { parent.appendChild(document.createTextNode(p.text)); return; }
      var v = convert(p.kind, p.arg, state.unit, function (id) { return find(recipe, id); }, scaleOf(recipe));
      parent.appendChild(el('span', 'rc-val', v === null ? '?' : v));
    });
  }

  function checked(recipe, key) { return !!(state.checks[recipe.id] && state.checks[recipe.id][key]); }

  function row(recipe, key, cls) {
    var li = el('li'), label = el('label', 'rc-row ' + cls), box = el('input');
    box.type = 'checkbox';
    box.checked = checked(recipe, key);
    box.addEventListener('change', function () {
      var c = state.checks[recipe.id] || (state.checks[recipe.id] = {});
      if (box.checked) c[key] = true; else delete c[key];
      save();
      counts();
    });
    label.appendChild(box);
    li.appendChild(label);
    return { li: li, label: label };
  }

  var countEls = {};
  function counts() {
    Object.keys(countEls).forEach(function (k) {
      var boxes = view.querySelectorAll('[data-sec="' + k + '"] input'), n = 0;
      Array.prototype.forEach.call(boxes, function (b) { if (b.checked) n++; });
      countEls[k].textContent = n + ' of ' + boxes.length;
    });
  }

  function section(title, key) {
    var sec = el('section', 'rc-sec'), h = el('h3', null, title), c = el('span', 'rc-count');
    h.appendChild(c);
    countEls[key] = c;
    sec.appendChild(h);
    return sec;
  }

  function build() {
    var r = current, sc = scaleOf(r);
    countEls = {};
    view.textContent = '';

    var head = el('header', 'rc-head'), no = recipes.indexOf(r) + 1;
    head.appendChild(el('p', 'rc-kicker j-mark', 'No. ' + (no < 10 ? '0' : '') + no));
    head.appendChild(el('h2', null, r.name));
    head.appendChild(el('p', 'rc-blurb', r.blurb));
    var meta = el('p', 'rc-meta');
    if (r.makes) { var mk = el('span'); rich(mk, r.makes, r); meta.appendChild(mk); }
    if (r.time) { var tm = el('span'); rich(tm, r.time, r); meta.appendChild(tm); }
    if (sc !== 1) meta.appendChild(el('span', 'rc-scaled', 'scaled ×' + num(sc, 2)));
    head.appendChild(meta);
    view.appendChild(head);
    if (bar) view.appendChild(bar);

    var ing = section('Ingredients', 'ing');
    ing.setAttribute('data-sec', 'ing');
    ing.appendChild(el('p', 'rc-tip', 'Put the bowl on the scale and press tare before each ingredient. Tick it once it is in.'));
    r.ingredients.forEach(function (g, gi) {
      if (g.group) ing.appendChild(el('h4', 'rc-group', g.group));
      var ul = el('ul', 'rc-list');
      g.items.forEach(function (it, ii) {
        var x = row(r, 'i' + gi + '.' + ii, 'rc-ing');
        x.label.appendChild(el('span', 'rc-amt', amount(it, state.unit, sc)));
        var name = el('span', 'rc-name', it.name), bits = [];
        if (it.note) bits.push(it.note);
        if (it.spoon) bits.push('about ' + spoon(it.spoon, sc));
        if (bits.length) { name.appendChild(document.createTextNode(' ')); var n = el('span', 'rc-note'); rich(n, bits.join(', '), r); name.appendChild(n); }
        x.label.appendChild(name);
        ul.appendChild(x.li);
      });
      ing.appendChild(ul);
    });
    view.appendChild(ing);

    var met = section('Steps', 'step');
    met.setAttribute('data-sec', 'step');
    var ol = el('ol', 'rc-list');
    r.steps.forEach(function (s, si) {
      var x = row(r, 's' + si, 'rc-step');
      x.label.appendChild(el('span', 'rc-n', String(si + 1)));
      var t = el('span', 'rc-text');
      rich(t, s, r);
      x.label.appendChild(t);
      ol.appendChild(x.li);
    });
    met.appendChild(ol);
    view.appendChild(met);

    if (r.notes && r.notes.length) {
      var nt = el('section', 'rc-sec rc-notes-sec');
      nt.appendChild(el('h3', null, 'Notes'));
      var nl = el('ul', 'rc-notes');
      r.notes.forEach(function (s) { var li = el('li'); rich(li, s, r); nl.appendChild(li); });
      nt.appendChild(nl);
      view.appendChild(nt);
    }

    // Previous and next recipe, and the way back to the list.
    var pager = el('nav', 'rc-pager j-print-hide'), at = recipes.indexOf(r);
    pager.setAttribute('aria-label', 'More recipes');
    [[recipes[at - 1], 'rc-prev', '← Previous'], [recipes[at + 1], 'rc-next', 'Next →']].forEach(function (p) {
      if (!p[0]) return;
      var a = el('a', p[1]);
      a.href = '#' + p[0].id;
      a.appendChild(el('span', 'j-label', p[2]));
      a.appendChild(document.createTextNode(p[0].name));
      pager.appendChild(a);
    });
    var all = el('a', 'rc-all', 'All recipes');
    all.href = location.pathname + location.search;
    all.addEventListener('click', toIndex);
    pager.appendChild(all);
    view.appendChild(pager);

    counts();
  }

  // The recipe tabs, the unit switch, the scale and the nav dropdown all show what is current.
  var scaleIn = document.getElementById('rc-scale');
  function sync() {
    var sc = current ? scaleOf(current) : 1, id = current && current.id;
    Array.prototype.forEach.call(document.querySelectorAll('[data-scale]'), function (b) { var on = Number(b.getAttribute('data-scale')) === sc; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    if (scaleIn && document.activeElement !== scaleIn) scaleIn.value = sc;
    Array.prototype.forEach.call(document.querySelectorAll('[data-unit]'), function (b) { b.classList.toggle('active', b.getAttribute('data-unit') === state.unit); b.setAttribute('aria-pressed', b.getAttribute('data-unit') === state.unit ? 'true' : 'false'); });
    Array.prototype.forEach.call(document.querySelectorAll('.nav-menu-list a[href*="/recipes/#"]'), function (a) {
      if (a.getAttribute('href').split('#')[1] === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  // Each index row says how much it makes and how long it takes, in the current units and scale.
  function fillIndex() {
    recipes.forEach(function (r) {
      var m = document.querySelector('[data-meta="' + r.id + '"]');
      if (!m) return;
      m.textContent = '';
      [r.makes, r.time].forEach(function (t) { if (t) { var sp = el('span'); rich(sp, t, r); m.appendChild(sp); } });
    });
  }

  // The index (no hash) lists the recipes; a hash opens that one recipe on its own.
  function show(r) {
    var was = current;
    if (r !== was) hideUndo();
    current = r;
    page.setAttribute('data-view', r ? 'recipe' : 'index');
    document.title = r ? r.name + ' · ' + title : title;
    if (r) build(); else { view.textContent = ''; fillIndex(); }
    sync();
    if (r !== was) window.scrollTo(0, 0);
  }

  function toIndex(e) {
    e.preventDefault();
    try { history.pushState(null, '', location.pathname + location.search); } catch (err) {}
    show(null);
  }
  var back = document.querySelector('.rc-back');
  if (back) back.addEventListener('click', toIndex);
  // Clear ticks wipes a recipe's progress, so for a few seconds the button becomes an Undo that puts the ticks back.
  var clear = document.querySelector('.rc-clear'), undoBox = document.querySelector('.rc-undo'), undo = null, undoTimer = null;
  function hideUndo() {
    var hadFocus = undoBox && undoBox.contains(document.activeElement);
    clearTimeout(undoTimer); undo = null;
    if (undoBox) undoBox.textContent = '';
    if (clear) { clear.hidden = false; if (hadFocus) clear.focus(); }
  }
  if (clear) clear.addEventListener('click', function () {
    var had = current && state.checks[current.id];
    if (!had || !Object.keys(had).length) return;
    delete state.checks[current.id]; save(); build();
    hideUndo();
    undo = { id: current.id, checks: had };
    if (undoBox) {
      undoBox.appendChild(document.createTextNode('Ticks cleared. '));
      var b = el('button', 'sim-tab', 'Undo');
      b.type = 'button';
      b.addEventListener('click', function () {
        if (!undo) return;
        state.checks[undo.id] = undo.checks; save();
        var same = current && current.id === undo.id;
        hideUndo();
        if (same) { build(); clear.focus(); }   // build() moves the bar, which drops focus
      });
      undoBox.appendChild(b);
      clear.hidden = true;
      b.focus();
    }
    undoTimer = setTimeout(hideUndo, 10000);
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-unit]'), function (b) {
    b.addEventListener('click', function () { state.unit = b.getAttribute('data-unit'); save(); if (current) build(); sync(); });
  });
  function setScale(s) {
    if (!current || !(s > 0 && s <= 100)) return;
    if (s === 1) delete state.scale[current.id]; else state.scale[current.id] = s;
    save(); build(); sync();
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-scale]'), function (b) {
    b.addEventListener('click', function () { setScale(Number(b.getAttribute('data-scale'))); });
  });
  if (scaleIn) {
    scaleIn.addEventListener('input', function () { setScale(parseFloat(scaleIn.value)); });
    scaleIn.addEventListener('blur', sync);
  }
  window.addEventListener('hashchange', function () { show(fromHash()); });
  window.addEventListener('popstate', function () { if (fromHash() !== current) show(fromHash()); });

  current = fromHash();
  show(current);
})(typeof window !== 'undefined' ? window : this);
