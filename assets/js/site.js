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

// Project tag filter.
(function () {
  var bar = document.querySelector('.filters');
  if (!bar) return;
  var cards = Array.prototype.slice.call(document.querySelectorAll('.card[data-tags]'));

  bar.addEventListener('click', function (e) {
    var btn = e.target.closest('.filter');
    if (!btn) return;
    var tag = btn.dataset.tag;

    bar.querySelectorAll('.filter').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b === btn));
    });
    cards.forEach(function (card) {
      card.hidden = tag !== '*' && card.dataset.tags.split('|').indexOf(tag) === -1;
    });
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
