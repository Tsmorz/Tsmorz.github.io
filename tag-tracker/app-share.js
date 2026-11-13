// Tag tracker page, part of index.html's script: printing, the Print dialog, the board and tags on another screen.
// The app-*.js files are classic scripts loaded in order and share one global scope; nothing in them runs
// another file's code at load (the boot script at the end of index.html starts everything).
'use strict';

// ---------------- printing ----------------
function grayToCanvas(img, quiet) {
  const q = quiet || 0, cv = document.createElement('canvas');
  cv.width = img.w + 2 * q; cv.height = img.h + 2 * q;
  const c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height);
  const id = c.createImageData(img.w, img.h);
  for (let i = 0; i < img.w * img.h; i++) { const v = img.data[i]; id.data[4 * i] = v; id.data[4 * i + 1] = v; id.data[4 * i + 2] = v; id.data[4 * i + 3] = 255; }
  c.putImageData(id, q, q);
  return cv;
}
function printPage(win, title, body, css) {
  win.document.open();
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>
    @page{margin:12mm}body{font:12px/1.5 system-ui,sans-serif;color:#111;margin:0;display:flex;flex-direction:column;align-items:center;gap:6mm;padding-top:4mm}
    img{image-rendering:pixelated;display:block}.cap{text-align:center;max-width:180mm}.rule{height:0;border-top:.4mm solid #111;width:50mm;position:relative}
    .rule.in{width:50.8mm}.bars{display:flex;gap:14mm;align-items:flex-end;break-inside:avoid}.bars>div{display:flex;flex-direction:column;align-items:center;gap:2.5mm;font-size:8pt}
    .rule::before,.rule::after{content:"";position:absolute;top:-1.6mm;height:3mm;border-left:.4mm solid #111}.rule::before{left:0}.rule::after{right:0}
    @media screen{body{background:#eee;padding:20px}.sheet{background:#fff;padding:10mm;box-shadow:0 2px 12px rgba(0,0,0,.15)}}${css || ''}</style></head>
    <body>${body}<script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`);
  win.document.close();
}
// ---------------- the Print dialog: any of your tags, other IDs, and the board, printed together ----------------
const PD = { chosen: new Set() };
// two check bars, for metric and inch rulers
const CHECK_BARS = '<div class="bars"><div><div class="rule"></div><span>50 mm</span></div><div><div class="rule in"></div><span>2 in</span></div></div>';
// The dialog, optionally with some tags (or the board) already chosen; the quick print buttons open it too.
function openPrintDlg(opts) {
  $('printFam').textContent = FAMILY_LABEL[S.settings.family];
  // the tag picked in the Now panel starts chosen
  PD.chosen = new Set(opts && opts.tags ? opts.tags : typeof S.tplotTag === 'number' && tagOf(S.tplotTag) ? [S.tplotTag] : []);
  $('printBoardSw').setAttribute('aria-checked', String(opts && 'board' in opts ? !!opts.board : S.mode === 'calib'));
  paintPaper();
  $('printSize').value = +(S.settings.tagSize * 1000).toFixed(1);
  $('printSquare').value = S.square;
  $('printIds').value = '';
  renderPrintDlg();
  $('printDlg').showModal();
}
function renderPrintDlg() {
  const box = $('printTags');
  box.innerHTML = S.tags.length ? S.tags.map((t) => `<button type="button" class="pick" data-id="${t.id}" aria-pressed="${PD.chosen.has(t.id)}"><span class="sw" style="background:${cssColorOf(t.id)}"></span>${escapeHtml(nameOf(t.id))}${t.name ? ` #${t.id}` : ''}, ${+(t.size * 1000).toFixed(1)} mm</button>`).join('')
    : '<span class="hint">No tags in your list yet: type their IDs below.</span>';
  box.querySelectorAll('.pick').forEach((b) => {
    b.onclick = () => { const id = +b.dataset.id; if (PD.chosen.has(id)) PD.chosen.delete(id); else PD.chosen.add(id); b.setAttribute('aria-pressed', String(PD.chosen.has(id))); paintPrintSummary(); };
  });
  paintPrintSummary();
}
// what is chosen: your tags at their own sizes, then the typed IDs at the typed size, and the board
function printChoice() {
  const extra = C.parseIdList($('printIds').value, S.familyCount, 100), size = +$('printSize').value / 1000, square = +$('printSquare').value;
  const tags = [...PD.chosen].map((id) => ({ id, size: sizeOf(id) }));
  for (const id of extra.ids) if (!PD.chosen.has(id)) tags.push({ id, size });
  return { tags, bad: extra.bad, typed: extra.ids.length, board: $('printBoardSw').getAttribute('aria-checked') === 'true', square, sizeOk: size >= 0.005 && size <= 2, squareOk: square >= 3 && square <= 200 };
}
function paintPrintSummary() {
  const ch = printChoice(), n = ch.tags.length, msg = $('printIdsMsg');
  const parts = [n ? `${n} tag${n > 1 ? 's' : ''}` : '', ch.board ? 'the board' : ''].filter(Boolean);
  const P = C.PAPER[S.paper], maxT = C.maxTagSize(S.paper, FAMILY_CELLS[S.settings.family]), maxSq = C.maxBoardSquare(S.paper);
  const big = ch.tags.filter((t) => t.size * 1000 > maxT + 1e-9), bigBoard = ch.board && ch.square > maxSq;
  const ok = (n || ch.board) && (!ch.typed || ch.sizeOk) && (!ch.board || ch.squareOk) && !ch.bad.length && !big.length && !bigBoard;
  const bm = $('printBoardMsg');
  bm.classList.toggle('bad', !!bigBoard);
  bm.textContent = bigBoard ? `At ${ch.square} mm squares the board is ${(9 * ch.square).toFixed(0)} × ${(6 * ch.square).toFixed(0)} mm, too big for ${P.name} at full size. Up to ${maxSq} mm fits; or show it on a screen (Calibrate, step 1).`
    : 'On its own landscape page. Glue it to card so it stays flat, then measure a square and enter it in Calibrate.';
  $('printSummary').textContent = parts.length ? parts.join(' and ') : 'Nothing chosen yet';
  $('printGo').disabled = !ok;
  msg.classList.toggle('bad', !!ch.bad.length || (ch.typed > 0 && !ch.sizeOk) || !!big.length);
  msg.textContent = ch.bad.length ? `Not ${FAMILY_LABEL[S.settings.family]} IDs (0 to ${S.familyCount - 1}): ${ch.bad.join(', ')}.`
    : ch.typed && !ch.sizeOk ? 'Enter a size from 5 to 2000 mm.'
    : big.length ? `Too big for ${P.name} at full size: ${big.map((t) => `#${t.id} (${+(t.size * 1000).toFixed(1)} mm)`).join(', ')}. Up to ${maxT} mm fits.`
    : 'Your tags print at their own sizes. Size is the black square; a white border of one cell is added round it.';
}
['printIds', 'printSize', 'printSquare'].forEach((id) => { $(id).oninput = paintPrintSummary; });
$('printBoardSw').onclick = () => { const b = $('printBoardSw'); b.setAttribute('aria-checked', String(b.getAttribute('aria-checked') !== 'true')); paintPrintSummary(); };
$('printBoard').onclick = () => openPrintDlg({ tags: [], board: true });
function paintPaper() {
  document.querySelectorAll('[data-paper]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.paper === S.paper)));
  const P = C.PAPER[S.paper];
  $('paperHint').textContent = S.paper === 'a4' ? `${P.w} × ${P.h} mm` : '8.5 × 11 in';
}
document.querySelectorAll('[data-paper]').forEach((b) => { b.onclick = () => { S.paper = b.dataset.paper; store.set('paper', S.paper); paintPaper(); paintPrintSummary(); }; });
$('printDlg').querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => $('printDlg').close(); });
$('printForm').onsubmit = (e) => {
  e.preventDefault();
  const ch = printChoice();
  if ($('printGo').disabled) return;
  // the print window opens now, inside the click, so pop-up blockers allow it; it fills in once the images are made
  const win = window.open('', '_blank');
  $('printDlg').close();
  if (!win) { alert('Allow pop-ups for this site to print.'); return; }
  win.document.write('<p style="font:14px system-ui;padding:20px">Making the page…</p>');
  printSet(win, ch);
};
async function printSet(win, ch) {
  const fam = S.settings.family, cells = FAMILY_CELLS[fam], label = FAMILY_LABEL[fam];
  const imgs = await Promise.all(ch.tags.map((t) => requestImage('tagImage', { family: fam, id: t.id, px: cells * 40 })));
  const figs = ch.tags.map((t, i) => {
    const cv = grayToCanvas(imgs[i], 40), mm = t.size * 1000, w = mm + (2 * mm) / cells, nm = tagOf(t.id) && tagOf(t.id).name;
    return `<figure class="tg"><img src="${cv.toDataURL()}" style="width:${w.toFixed(2)}mm;height:${w.toFixed(2)}mm" alt="${label} tag ${t.id}"><figcaption><b>ID ${t.id}</b>${nm ? ', ' + escapeHtml(nm) : ''}<br>${label}, black square ${mm.toFixed(1)} mm</figcaption></figure>`;
  }).join('');
  let board = '';
  if (ch.board) {
    const img = await requestImage('boardImage', { px: 100 }), sq = ch.square;
    S.square = sq; store.set('square', sq); $('square').value = sq;
    board = `<section class="bp"><img src="${grayToCanvas(img, 0).toDataURL()}" style="width:${(9 * sq).toFixed(1)}mm;height:${(6 * sq).toFixed(1)}mm" alt="ChArUco calibration board">
      <div class="cap">ChArUco board, 9 × 6 squares of ${sq} mm, DICT_5X5_100, on ${C.PAPER[S.paper].name}. Keep it flat (glue it to card), measure a square and enter it in Tag Tracker. The bars below should measure 50 mm and 2 inches.</div>${CHECK_BARS}</section>`;
  }
  const tags = ch.tags.length ? `<section class="tp"><div class="tags">${figs}</div>
    <div class="cap">Printed for ${C.PAPER[S.paper].name} at 100% (“fit to page” off). The bars below should measure 50 mm and 2 inches. If a black square doesn’t measure its size, enter what it measures in Tag Tracker.</div>${CHECK_BARS}</section>` : '';
  const title = [ch.tags.length ? `${label} ${ch.tags.map((t) => t.id).join(', ')}` : '', ch.board ? 'Calibration board' : ''].filter(Boolean).join(' and ');
  const P = C.PAPER[S.paper];
  printPage(win, escapeHtml(title), tags + board, `
    @page{size:${P.css};margin:12mm}
    @page board{size:${P.css} landscape;margin:12mm}
    .tp,.bp{display:flex;flex-direction:column;align-items:center;gap:6mm;width:100%}
    .bp{page:board}.tp+.bp{break-before:page}
    .tags{display:flex;flex-wrap:wrap;gap:6mm 8mm;justify-content:center;align-items:flex-start;max-width:186mm}
    .tg{margin:0;display:flex;flex-direction:column;align-items:center;gap:1.5mm;break-inside:avoid}
    .tg figcaption{font-size:9pt;line-height:1.3;text-align:center}`);
}

$('pngBoard').onclick = async () => {
  const img = await requestImage('boardImage', { px: 160 }), cv = grayToCanvas(img, 80);
  cv.toBlob((b) => download(b, 'charuco-9x6-5x5_100.png'));
};

// ---------------- the board on a screen: /tag-tracker/#board, a link to open on a tablet or second monitor ----------------
const BOARD_HASH = '#board';
const boardLink = () => location.origin + location.pathname + BOARD_HASH;
const BV = { seq: 0, img: null, hideT: 0, resizeT: 0, lock: null, mode: 'board', tags: null, ti: 0, down: null };
const linkFor = (hash) => location.origin + location.pathname + hash;
// Tags on a screen: /tag-tracker/#tags=2:Body,0:Left%20wrist lists tag IDs, each with an optional name, shown one at a
// time as big as the screen allows (&f= picks a family other than tag36h11).
function parseTagsHash(h) {
  const m = /^#tags=([^&]*)(?:&f=([A-Za-z0-9_]+))?$/.exec(h || '');
  if (!m) return null;
  const list = [];
  for (const part of m[1].split(',')) {
    const i = part.indexOf(':'), a = i < 0 ? part : part.slice(0, i), id = Number(a);
    let name = '';
    try { name = i < 0 ? '' : decodeURIComponent(part.slice(i + 1)).slice(0, 40); } catch (e) { /* a mangled name: none */ }
    if (a !== '' && Number.isInteger(id) && id >= 0 && id < 2500) list.push({ id, name });
  }
  return list.length ? { list, family: m[2] && FAMILY_CELLS[m[2]] ? m[2] : null } : null;
}
const tagsHash = (list) => '#tags=' + list.map((t) => t.id + (t.name ? ':' + encodeURIComponent(t.name) : '')).join(',') + (S.settings.family !== 'APRILTAG_36h11' ? '&f=' + S.settings.family : '');
function qrSvg(text, aria) {
  if (typeof qrcode !== 'function') return '';
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  const n = q.getModuleCount(), z = 4, s = n + 2 * z;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + z} ${r + z}h1v1h-1z`;
  return `<svg viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges" role="img" aria-label="${escapeHtml(aria || 'QR code of the board link')}"><rect width="${s}" height="${s}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
$('screenBoard').onclick = () => {
  const p = $('sharePanel'), open = p.hidden;
  p.hidden = !open; $('screenBoard').setAttribute('aria-expanded', String(open));
  if (!open) return;
  const url = boardLink();
  $('shareUrl').value = url; $('shareQr').innerHTML = qrSvg(url); $('shareQr').hidden = !$('shareQr').innerHTML;
  $('shareSend').hidden = !navigator.share;
};
$('shareUrl').onfocus = () => $('shareUrl').select();
$('shareCopy').onclick = async () => {
  try { await navigator.clipboard.writeText(boardLink()); } catch (e) { $('shareUrl').select(); document.execCommand('copy'); }
  $('shareCopy').textContent = 'Copied'; setTimeout(() => { $('shareCopy').textContent = 'Copy link'; }, 1500);
};
$('shareSend').onclick = () => navigator.share({ title: 'Calibration board', text: 'A ChArUco board to show full-screen while Tag Tracker calibrates a camera.', url: boardLink() }).catch(() => {});
$('shareWin').onclick = () => { window.open(boardLink(), '_blank', 'noopener'); };
$('shareHere').onclick = () => { location.hash = BOARD_HASH; };
// A share panel for any link: its QR code, the link, Copy, Share…, a new window, and Show here.
function fillShare(box, url, o) {
  box.innerHTML = `<div class="qr">${qrSvg(url, o.aria)}</div><div class="sbody"><p>${o.blurb}</p><label class="sr" for="${box.id}Url">Link</label><input id="${box.id}Url" class="input sm" type="text" readonly>` +
    `<div class="row"><button type="button" class="btn sm outline" data-a="copy">Copy link</button><button type="button" class="btn sm outline" data-a="send"${navigator.share ? '' : ' hidden'}>Share…</button>` +
    '<button type="button" class="btn sm outline" data-a="win">Open in a new window</button><button type="button" class="btn sm" data-a="here">Show here</button></div><p class="credit">QR code by qrcode-generator (MIT, Kazuhiko Arase).</p></div>';
  const inp = box.querySelector('input'), q = box.querySelector('.qr');
  inp.value = url; inp.onfocus = () => inp.select(); q.hidden = !q.innerHTML;
  box.querySelector('[data-a=copy]').onclick = async (e) => {
    try { await navigator.clipboard.writeText(url); } catch (err) { inp.select(); document.execCommand('copy'); }
    e.target.textContent = 'Copied'; setTimeout(() => { e.target.textContent = 'Copy link'; }, 1500);
  };
  box.querySelector('[data-a=send]').onclick = () => navigator.share({ title: o.title, text: o.text, url }).catch(() => {});
  box.querySelector('[data-a=win]').onclick = () => window.open(url, '_blank', 'noopener');
  box.querySelector('[data-a=here]').onclick = () => { for (const d of ['setupDlg', 'shareDlg']) if ($(d).open) $(d).close(); location.hash = url.slice(url.indexOf('#')); };
  box.hidden = false;
}
function shareTagsTo(box, list) {
  if (!list.length) { box.innerHTML = '<p class="hint">Add a tag first: by its ID, or show one to the camera.</p>'; box.hidden = false; return; }
  fillShare(box, linkFor(tagsHash(list)), {
    aria: 'QR code of the link to your tags', title: 'AprilTags', text: 'AprilTags to show on a phone while Tag Tracker tracks them.',
    blurb: `Open this on your phone: scan the code with its camera, or send the link. Its screen shows ${list.length > 1 ? `the ${list.length} tags one at a time (tap the sides for the next)` : 'the tag'}, as big as it can, and stays awake. Measure the black square on the screen and enter that as the tag's size.`,
  });
}
// On a phone or tablet (a touch screen) the page is already on the phone: show the tags here, full screen. Elsewhere,
// the QR code and link, scrolled into view (it opens under the tag list, which can be long).
const onPhone = () => matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 900;
function showTagShare(list) {
  if (list.length && onPhone()) { location.hash = tagsHash(list); return; }
  shareTagsTo($('tagShare'), list);
  $('h-share').textContent = list.length === 1 ? `Show ${list[0].name || 'tag #' + list[0].id} on a phone` : 'Show your tags on a phone';
  if (!$('shareDlg').open) $('shareDlg').showModal();
}
$('tagsPhone').onclick = () => showTagShare(S.tags.map((t) => ({ id: t.id, name: t.name })));
$('shareDlg').querySelector('[data-close]').onclick = () => $('shareDlg').close();
$('shareDlg').addEventListener('click', (e) => { if (e.target === $('shareDlg')) $('shareDlg').close(); }); // the backdrop

function bvBar(show) {
  clearTimeout(BV.hideT); $('bvBar').classList.toggle('gone', !show);
  if (show) BV.hideT = setTimeout(() => bvBar(false), 5000); // then nothing covers the board
}
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !BV.lock) { BV.lock = await navigator.wakeLock.request('screen'); BV.lock.addEventListener('release', () => { BV.lock = null; }); }
    if (!on && BV.lock) { const l = BV.lock; BV.lock = null; await l.release(); }
  } catch (e) { /* not allowed here; the screen may dim on its own */ }
}
// one tag on the screen, whole pixels per cell, a cell of white round it, its name and number under it
async function drawTagView() {
  const seq = ++BV.seq, dpr = window.devicePixelRatio || 1, T = BV.tags, t = T.list[BV.ti], fam = T.family || S.settings.family, cells = FAMILY_CELLS[fam];
  // a cell and a half of white round it, so the arrows at the screen's edges stay clear of the tag's quiet zone
  const f = C.tagFit(Math.round(innerWidth * dpr), Math.round((innerHeight - 64) * dpr), cells, 1.5), cv = $('boardCanvas');
  $('bvCap').textContent = `${t.name ? t.name + ', ' : ''}#${t.id}${T.list.length > 1 ? ` (${BV.ti + 1} of ${T.list.length})` : ''}`;
  if (f.px < 4) { cv.width = cv.height = 0; $('bvMsg').textContent = 'This screen is too small to show the tag.'; bvBar(true); return; }
  if (!S.ready) $('bvMsg').textContent = 'Loading the tags (OpenCV.js, about 10 MB the first time)…';
  await workerReady;
  const img = await requestImage('tagImage', { family: fam, id: t.id, px: f.size });
  if (seq !== BV.seq || $('boardView').hidden) return; // moved on, resized or closed meanwhile
  cv.width = f.size; cv.height = f.size; cv.style.width = f.size / dpr + 'px'; cv.style.height = f.size / dpr + 'px';
  const c = cv.getContext('2d');
  c.imageSmoothingEnabled = false; c.drawImage(grayToCanvas(img, 0), 0, 0);
  cv.setAttribute('aria-label', `AprilTag ${t.id}, ${FAMILY_LABEL[fam]}`);
  $('bvMsg').innerHTML = `<b>${escapeHtml(t.name || 'Tag')} #${t.id}</b>, ${FAMILY_LABEL[fam]}. Measure the black square on this screen and enter it as the tag's size in Tag Tracker. Turn the brightness up and tilt the phone so nothing reflects in it. ` +
    (T.list.length > 1 ? 'Tap the sides (or swipe) for the other tags; tap the middle to show this again.' : 'Tap to show this again.');
}
function stepTag(d) { if (BV.mode !== 'tags') return; const n = BV.tags.list.length; BV.ti = (BV.ti + d + n) % n; drawScreen(); }
const drawScreen = () => (BV.mode === 'tags' ? drawTagView() : drawBoardView());
async function drawBoardView() {
  const seq = ++BV.seq, dpr = window.devicePixelRatio || 1;
  const f = C.boardFit(Math.round(innerWidth * dpr), Math.round(innerHeight * dpr), 9, 6, 0.5), cv = $('boardCanvas');
  if (f.px < 8) { cv.width = cv.height = 0; $('bvMsg').textContent = 'This screen is too small to show the board. Use a tablet or a monitor.'; bvBar(true); return; }
  if (!S.ready) $('bvMsg').textContent = 'Loading the board (OpenCV.js, about 10 MB the first time)…';
  await workerReady;
  if (!BV.img || BV.img.px !== f.px) BV.img = { px: f.px, img: await requestImage('boardImage', { px: f.px }) };
  if (seq !== BV.seq || $('boardView').hidden) return; // resized or closed meanwhile
  cv.width = f.w; cv.height = f.h; cv.style.width = f.w / dpr + 'px'; cv.style.height = f.h / dpr + 'px';
  const c = cv.getContext('2d'), src = grayToCanvas(BV.img.img, 0);
  c.imageSmoothingEnabled = false;
  c.save(); if (f.rotate) { c.translate(f.w, 0); c.rotate(Math.PI / 2); } c.drawImage(src, 0, 0); c.restore();
  cv.setAttribute('aria-label', 'ChArUco calibration board, 9 by 6 squares');
  $('bvMsg').innerHTML = `<b>Calibration board</b>, 9 × 6 squares. Measure across all 9 squares with a ruler, divide by 9, and enter it as the square size where you calibrate. ` +
    'Brightness about two-thirds; tilt it so nothing reflects in it. Tap to show this again.';
}
function showBoardView(mode) {
  BV.mode = mode || 'board';
  const tags = BV.mode === 'tags';
  $('bvCap').hidden = !tags; $('bvPrev').hidden = $('bvNext').hidden = !tags || BV.tags.list.length < 2;
  if (!$('boardView').hidden) { drawScreen(); return; }
  if ($('setupDlg').open) $('setupDlg').close();
  $('boardView').hidden = false; document.documentElement.classList.add('bv-open');
  $('bvFull').hidden = !(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
  bvBar(true); keepAwake(true); drawScreen();
}
function hideBoardView() {
  if ($('boardView').hidden) return;
  $('boardView').hidden = true; document.documentElement.classList.remove('bv-open'); BV.seq++;
  keepAwake(false);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (location.hash === BOARD_HASH || parseTagsHash(location.hash)) history.replaceState(null, '', location.pathname + location.search);
}
$('bvFull').onclick = () => {
  const el = $('boardView'), go = el.requestFullscreen || el.webkitRequestFullscreen;
  if (go) Promise.resolve(go.call(el)).catch(() => {});
  bvBar(false);
};
$('bvClose').onclick = hideBoardView;
// a tap shows the instructions again; with several tags, a tap on either side (or a swipe) shows the next one
$('boardView').addEventListener('pointerdown', (e) => { BV.down = e.target.closest('.bv-bar, .bv-nav') ? null : [e.clientX, e.clientY]; });
$('boardView').addEventListener('pointerup', (e) => {
  if (!BV.down) return;
  const dx = e.clientX - BV.down[0]; BV.down = null;
  if (BV.mode === 'tags' && BV.tags.list.length > 1) {
    if (Math.abs(dx) > 60) return stepTag(dx < 0 ? 1 : -1);
    const x = e.clientX / innerWidth;
    if (x < 0.25) return stepTag(-1);
    if (x > 0.75) return stepTag(1);
  }
  bvBar(true);
});
$('bvPrev').onclick = () => stepTag(-1);
$('bvNext').onclick = () => stepTag(1);
document.addEventListener('keydown', (e) => {
  if ($('boardView').hidden) return;
  if (e.key === 'Escape' && !document.fullscreenElement) hideBoardView();
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); stepTag(e.key === 'ArrowLeft' ? -1 : 1); }
});
document.addEventListener('visibilitychange', () => { if (!$('boardView').hidden && document.visibilityState === 'visible') keepAwake(true); });
window.addEventListener('resize', () => { if (!$('boardView').hidden) { clearTimeout(BV.resizeT); BV.resizeT = setTimeout(drawScreen, 150); } });
const routeHash = () => {
  const t = parseTagsHash(location.hash);
  if (location.hash === BOARD_HASH) showBoardView('board');
  else if (t) { BV.tags = t; BV.ti = 0; showBoardView('tags'); } else hideBoardView();
};
window.addEventListener('hashchange', routeHash);
