// RecipeCore + the /recipes/ page. Every amount in _data/recipes.yml is a weight in grams, so the recipes run on a
// kitchen scale; RecipeCore turns grams, °C, cm and mL into the visitor's units. It has no DOM, so script/test-recipes
// can load it in Node. The page keeps the unit choice and the ticked boxes in localStorage.
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

  var UNITS = { g: mass, t: temp, len: length, ml: volume };
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

  // The amount of an ingredient: its weight, or its `qty` text when it can't be weighed.
  function amount(item, unit) { return item.g != null ? mass(item.g, unit) : String(item.qty || ''); }

  // One token as text. `find(id)` returns an ingredient (for [[i:id]]); a range "22-26" shares one unit: "22–26 °C".
  function convert(kind, arg, unit, find) {
    if (kind === 'i') { var it = find && find(arg); return it ? amount(it, unit) : null; }
    var f = UNITS[kind], m = /^(-?[\d.]+)(?:-([\d.]+))?$/.exec(arg.trim());
    if (!f || !m) return null;
    var a = f(Number(m[1]), unit);
    if (m[2] === undefined) return a;
    var b = f(Number(m[2]), unit), ua = /\s(\S+)$/.exec(a), ub = /\s(\S+)$/.exec(b);
    return (ua && ub && ua[1] === ub[1] ? a.slice(0, a.length - ua[0].length) : a) + '–' + b;
  }

  // A whole string with its tokens replaced; an unknown token stays visible as "?" so a typo shows up in the tests.
  function render(text, unit, find) {
    return split(text).map(function (p) {
      if (p.text !== undefined) return p.text;
      var v = convert(p.kind, p.arg, unit, find);
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

  var RecipeCore = { mass: mass, temp: temp, length: length, volume: volume, split: split, amount: amount, convert: convert, render: render, find: find, GRAMS_PER_OZ: OZ };
  if (typeof module !== 'undefined' && module.exports) module.exports = RecipeCore;
  root.RecipeCore = RecipeCore;

  // ---- the page ----
  if (typeof document === 'undefined') return;
  var view = document.getElementById('rc-view'), dataEl = document.getElementById('rc-data');
  if (!view || !dataEl) return;

  var recipes = JSON.parse(dataEl.textContent);
  var KEY = 'recipes';
  var state = { unit: 'metric', checks: {} };
  try { var saved = JSON.parse(localStorage.getItem(KEY) || '{}'); if (saved.unit === 'imperial') state.unit = 'imperial'; if (saved.checks) state.checks = saved.checks; } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

  var current = recipes[0];
  function fromHash() {
    var id = decodeURIComponent(location.hash.replace(/^#/, ''));
    return recipes.filter(function (r) { return r.id === id; })[0] || recipes[0];
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
      var v = convert(p.kind, p.arg, state.unit, function (id) { return find(recipe, id); });
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
    var r = current;
    countEls = {};
    view.textContent = '';

    var head = el('header', 'rc-head');
    head.appendChild(el('h2', null, r.name));
    head.appendChild(el('p', 'rc-blurb', r.blurb));
    var meta = el('p', 'rc-meta');
    if (r.makes) { var mk = el('span'); rich(mk, r.makes, r); meta.appendChild(mk); }
    if (r.time) { var tm = el('span'); rich(tm, r.time, r); meta.appendChild(tm); }
    head.appendChild(meta);
    view.appendChild(head);

    var ing = section('Ingredients', 'ing');
    ing.setAttribute('data-sec', 'ing');
    ing.appendChild(el('p', 'rc-tip', 'Put the bowl on the scale and press tare before each ingredient. Tick it once it is in.'));
    r.ingredients.forEach(function (g, gi) {
      if (g.group) ing.appendChild(el('h4', 'rc-group', g.group));
      var ul = el('ul', 'rc-list');
      g.items.forEach(function (it, ii) {
        var x = row(r, 'i' + gi + '.' + ii, 'rc-ing');
        x.label.appendChild(el('span', 'rc-amt', amount(it, state.unit)));
        var name = el('span', 'rc-name', it.name), bits = [];
        if (it.note) bits.push(it.note);
        if (it.spoon) bits.push('about ' + it.spoon);
        if (bits.length) { name.appendChild(document.createTextNode(' ')); var n = el('span', 'rc-note'); rich(n, bits.join(', '), r); name.appendChild(n); }
        x.label.appendChild(name);
        ul.appendChild(x.li);
      });
      ing.appendChild(ul);
    });
    view.appendChild(ing);

    var met = section('Method', 'step');
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
      var nt = el('section', 'rc-sec');
      nt.appendChild(el('h3', null, 'Notes'));
      var nl = el('ul', 'rc-notes');
      r.notes.forEach(function (s) { var li = el('li'); rich(li, s, r); nl.appendChild(li); });
      nt.appendChild(nl);
      view.appendChild(nt);
    }

    var clear = el('button', 'sim-tab rc-clear', 'Clear ticks');
    clear.type = 'button';
    clear.addEventListener('click', function () { delete state.checks[r.id]; save(); build(); });
    view.appendChild(clear);

    counts();
  }

  // The recipe tabs, the unit switch and the nav dropdown all show what is current.
  function sync() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-recipe]'), function (b) { b.classList.toggle('active', b.getAttribute('data-recipe') === current.id); b.setAttribute('aria-pressed', b.getAttribute('data-recipe') === current.id ? 'true' : 'false'); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-unit]'), function (b) { b.classList.toggle('active', b.getAttribute('data-unit') === state.unit); b.setAttribute('aria-pressed', b.getAttribute('data-unit') === state.unit ? 'true' : 'false'); });
    Array.prototype.forEach.call(document.querySelectorAll('.nav-menu-list a[href*="/recipes/#"]'), function (a) {
      if (a.getAttribute('href').split('#')[1] === current.id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  function show(r) { current = r; build(); sync(); }

  Array.prototype.forEach.call(document.querySelectorAll('[data-recipe]'), function (b) {
    b.addEventListener('click', function () {
      var r = recipes.filter(function (x) { return x.id === b.getAttribute('data-recipe'); })[0];
      try { history.replaceState(null, '', '#' + r.id); } catch (e) {}
      show(r);
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-unit]'), function (b) {
    b.addEventListener('click', function () { state.unit = b.getAttribute('data-unit'); save(); build(); sync(); });
  });
  window.addEventListener('hashchange', function () { show(fromHash()); });

  show(fromHash());
})(typeof window !== 'undefined' ? window : this);
