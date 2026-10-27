// LabShell — the lesson frame every lab page shares (/controls/, /vision/): the predict-first and check cards, the
// lesson map (a row per demo, a pill per lesson), the URL hash, and the ticks remembered in localStorage.
// The page's engine (lab.js, vision.js) builds the panels and draws the views; it asks the shell which lesson is open.
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }

  /* ================= predict-first cards ================= */
  // A tab deep-links as "#<tab>".
  function hashTab() { return location.hash.slice(1).split('?')[0]; }

  // A multiple-choice card: pick, then reveal. A `try` line is shown once an answer is picked (the
  // prediction uses it); `why[i]` says why a wrong option i is wrong; onReveal runs after the answer.
  function quizCard(P, title, phase, onReveal) {
    var card = el('div', 'lab-card lab-quiz');
    if (phase) card.appendChild(el('span', 'lab-phase', phase));
    card.appendChild(el('h4', 'lab-card-title', title));
    card.appendChild(el('p', 'lab-q', P.question));
    var opts = el('div', 'lab-opts'), follow = el('div', 'lab-follow'); follow.hidden = true;
    var picked = null, btns = P.options.map(function (o, i) {
      var b = el('button', 'lab-opt', o); b.type = 'button';
      b.addEventListener('click', function () {
        picked = i; btns.forEach(function (x, k) { x.classList.toggle('picked', k === i); x.setAttribute('aria-pressed', k === i ? 'true' : 'false'); });
        follow.hidden = false; verdict.hidden = true; reveal.hidden = false;
      });
      b.setAttribute('aria-pressed', 'false'); opts.appendChild(b); return b;
    });
    card.appendChild(opts);
    if (P.try) follow.appendChild(el('p', 'lab-try', '<strong>Now try it:</strong> ' + P.try));
    var reveal = el('button', 'sim-btn', 'Show the answer'); reveal.type = 'button'; follow.appendChild(reveal);
    var verdict = el('div', 'lab-verdict'); verdict.hidden = true; verdict.setAttribute('aria-live', 'polite'); follow.appendChild(verdict);
    reveal.addEventListener('click', function () {
      var right = picked === P.answer, why = !right && P.why && P.why[picked] ? ' ' + P.why[picked] : '';
      btns.forEach(function (x, k) { x.classList.toggle('right', k === P.answer); x.classList.toggle('wrong', k === picked && !right); });
      verdict.innerHTML = '<p><strong>' + (right ? 'Right.' : 'Not quite: it\'s "' + P.options[P.answer] + '".') + '</strong>' + why + ' ' + P.explain + '</p>';
      verdict.hidden = false; reveal.hidden = true; if (onReveal) onReveal();
    });
    card.appendChild(follow); return card;
  }
  // Reactivate: a prediction above the sim (its answer opens the explanation). Evaluate: closing checks.
  function buildLearn(tab) {
    var sec = document.getElementById('sec-' + tab.id), slot = sec && sec.querySelector('.lab-check-slot'), pslot = sec && sec.querySelector('.lab-predict-slot');
    if (tab.predict && pslot) pslot.appendChild(quizCard(tab.predict, 'Predict first', '', function () { var d = sec.querySelector('.lab-inform'); if (d) d.open = true; }));
    var checks = tab.check ? (Array.isArray(tab.check) ? tab.check : [tab.check]) : [];
    if (slot) checks.forEach(function (c, i) { slot.appendChild(quizCard(c, checks.length > 1 ? 'Check yourself (' + (i + 1) + ' of ' + checks.length + ')' : 'Check yourself', '5 · Evaluate')); });
  }

  /* ================= tabs ================= */
  // One map: a row per demo, a pill per lesson. A hash names a lesson or a demo (a demo opens at its first lesson).
  // The map collapses to the current demo's row once the visitor has picked something; "Show all" brings it back.
  // A pill gets a tick when every task in the lesson is ticked and every check is answered (remembered in localStorage).
  // onActivate(i) runs whenever lesson i is opened.
  function start(CFG, onActivate) {
    CFG.tabs.forEach(buildLearn);
    var tabEls = CFG.tabs.map(function (t) { return document.getElementById('tab-' + t.id); }), secEls = CFG.tabs.map(function (t) { return document.getElementById('sec-' + t.id); });
    var mapEl = document.querySelector('.lab-map'), mapRows = Array.prototype.slice.call(document.querySelectorAll('.lab-map-row')), mapToggle = document.querySelector('.lab-map-toggle');
    var DONE_KEY = 'lab-done:' + CFG.page, done = {};
    try { (JSON.parse(localStorage.getItem(DONE_KEY)) || []).forEach(function (id) { done[id] = true; }); } catch (e) {}
    function tabIndex(id) { for (var i = 0; i < CFG.tabs.length; i++) if (CFG.tabs[i].id === id) return i; return -1; }
    var cur = 0;
    function paintMap() {
      var needs = CFG.tabs[cur].needs || [];
      tabEls.forEach(function (t, k) {
        var id = CFG.tabs[k].id;
        t.classList.toggle('active', k === cur); t.setAttribute('aria-selected', k === cur ? 'true' : 'false');
        t.classList.toggle('done', !!done[id]);
        t.classList.toggle('prereq', k !== cur && needs.indexOf(id) >= 0 && !done[id]);
        t.title = t.classList.contains('prereq') ? 'Builds on this' : '';
      });
    }
    function setCollapsed(c) {
      mapEl.classList.toggle('collapsed', c); mapToggle.textContent = c ? 'Show all lessons' : 'Show fewer'; mapToggle.setAttribute('aria-expanded', c ? 'false' : 'true');
    }
    function activate(i) {
      cur = i; var d = CFG.tabs[i].demo;
      secEls.forEach(function (s, k) { s.classList.toggle('active', k === i); });
      mapRows.forEach(function (r) { r.classList.toggle('current', r.getAttribute('data-demo') === d); });
      paintMap();
      if (onActivate) onActivate(i);
    }
    function refreshDone(i) {
      var sec = secEls[i], id = CFG.tabs[i].id; if (done[id]) return;
      var boxes = sec.querySelectorAll('.lab-tasks input'), ok = true;
      Array.prototype.forEach.call(boxes, function (b) { if (!b.checked) ok = false; });
      Array.prototype.forEach.call(sec.querySelectorAll('.lab-check-slot .lab-verdict'), function (v) { if (v.hidden) ok = false; });
      if (!ok || (!boxes.length && !sec.querySelector('.lab-check-slot .lab-verdict'))) return;
      done[id] = true; paintMap();
      try { localStorage.setItem(DONE_KEY, JSON.stringify(Object.keys(done))); } catch (e) {}
    }
    secEls.forEach(function (s, i) { s.addEventListener('change', function () { refreshDone(i); }); s.addEventListener('click', function () { refreshDone(i); }); });
    function firstOf(demo) { for (var i = 0; i < CFG.tabs.length; i++) if (CFG.tabs[i].demo === demo) return i; return 0; }
    function fromHash() {
      var h = hashTab(), idx = tabIndex(h);
      activate(idx >= 0 ? idx : firstOf(h));
    }
    tabEls.forEach(function (t, i) { t.addEventListener('click', function () { activate(i); setCollapsed(true); history.replaceState(null, '', i === 0 ? location.pathname + location.search : '#' + CFG.tabs[i].id); }); });
    mapToggle.addEventListener('click', function () { setCollapsed(!mapEl.classList.contains('collapsed')); });
    window.addEventListener('hashchange', function () {
      fromHash(); setCollapsed(true);
      mapEl.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });   // "Next:" links live at the bottom
    });
    fromHash(); setCollapsed(!!hashTab());
    return { secEls: secEls, current: function () { return cur; } };
  }

  root.LabShell = { start: start, quizCard: quizCard, el: el };
})(typeof window !== 'undefined' ? window : this);
