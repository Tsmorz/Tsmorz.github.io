// Tag tracker page, part of index.html's script: shared state, theme, tags and objects, settings inputs, tare, status line.
// The app-*.js files are classic scripts loaded in order and share one global scope; nothing in them runs
// another file's code at load (the boot script at the end of index.html starts everything).
'use strict';

const C = window.TagCore;
const $ = (id) => document.getElementById(id);
const SLOTS = 8;
const FAMILY_LABEL = { APRILTAG_36h11: 'tag36h11', APRILTAG_25h9: 'tag25h9', APRILTAG_16h5: 'tag16h5', APRILTAG_36h10: 'tag36h10' };
const FAMILY_CELLS = { APRILTAG_36h11: 8, APRILTAG_25h9: 7, APRILTAG_16h5: 6, APRILTAG_36h10: 8 }; // black square, in bits
const TARGET_VIEWS = 15, MIN_VIEWS = 6;
const store = {
  get(k, d) { try { const v = localStorage.getItem('tag-tracker:' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('tag-tracker:' + k, JSON.stringify(v)); } catch (e) { /* private mode: keep in memory */ } },
};

// ---------------- state ----------------
// The 3D view's starting angle, and where Reset view goes back to: from behind you, looking at the camera, so your
// right is on the screen's right; turned a little to the side (by 1 rad), so a robot's arms show past its body.
const VIEW0 = { yaw: Math.PI - 1, pitch: 0.45 };
const view0 = () => ({ ...VIEW0 });
const S = {
  settings: C.clampSettings(store.get('settings', {})),
  tags: store.get('tags', []), // {id, name, size (m), slot}
  calibs: store.get('calibs', {}), // camera label -> calibration (labels survive reloads; device ids may not)
  square: store.get('square', 25),
  quality: store.get('quality', 'precise'),
  res: store.get('res', '1280x720'),
  camId: store.get('camId', ''),
  mode: 'track', tab: 'track',
  worker: null, ready: false, familyCount: 587,
  // the running cameras (see "cameras" below); the first is camera 1, whose frame the rig and the plot use
  cams: [], running: false, demo: null, firstKey: null, calibCam: 0, calibFor: '',
  // the rig: each camera's saved pose (by camera key); views of the board for placing cameras; fused poses per track
  rig: store.get('rig', null), rigViews: [], lastRig: 0, rigAuto: true, rigFresh: null,
  arrange: Object.assign({ mode: 'auto', tiles: {} }, store.get('arrange', {})),
  paper: C.PAPER[store.get('paper', '')] ? store.get('paper', '') : C.paperFor(navigator.language), // a4 or letter
  camNames: store.get('camNames', {}), // camera key → the name the visitor gave it (lens calibrations stay keyed by the device's own label)
  fused: new Map(), zs: new Map(), vel: new Map(),
  // Tracks are keyed by tag id (a number) or 'b:<id>' for a rigid object. hist holds the plotted poses (in the
  // chosen frame), rawHist the raw ones for "Compare with raw", filters one PoseFilter per track, tracks the
  // latest camera-frame state per track, seen the last sighting of every tag id.
  hist: new C.History(), rawHist: new C.History(), filters: new Map(), tracks: new Map(), seen: new Map(),
  bodies: store.get('bodies', []), // {id, name, members: [{id, R, t}] (first is the origin), spread}
  learn: null, // {id, name, ids, samples: {id: [poses]}} while an object's shape is being learned
  views: [], lastCapture: 0, auto: true, calibResult: null,
  view: { ...VIEW0, dist: 2.6, target: [0, 1.0, 0], fitted: false, fromCam: true }, // fromCam: the first fit looks from camera 1, as Reset view does
  tplotTag: null, tplotMode: ['quat', 'position', 'velocity', 'joints'].includes(store.get('tplotMode')) ? store.get('tplotMode') : 'velocity', // (Motion, the old default, is now Velocity)
  jointSide: 1, // the arm the Joint angles plot shows
  // Tare: per track, the orientation (in the plotted frame) that reads as the identity; kept until cleared or the frame changes
  tare: new Map(),
};
Object.assign(S.view, view0());
const plot = $('plot'), tplot = $('tplot');

// ---------------- theme ----------------
function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}
function paintThemeBtn() {
  const d = isDark();
  $('themeBtn').innerHTML = `<svg class="i"><use href="#i-${d ? 'sun' : 'moon'}"/></svg>`;
  $('themeBtn').setAttribute('aria-label', d ? 'Switch to light theme' : 'Switch to dark theme');
  readColors();
}
(() => { const t = store.get('theme', null); if (t) document.documentElement.dataset.theme = t; })();
$('themeBtn').onclick = () => { const t = isDark() ? 'light' : 'dark'; document.documentElement.dataset.theme = t; store.set('theme', t); paintThemeBtn(); };
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintThemeBtn);
let K = {};
function readColors() {
  const cs = getComputedStyle(document.documentElement), g = (n) => cs.getPropertyValue('--' + n).trim();
  K = { text: g('ink'), text2: g('ink2'), muted: g('muted'), grid: g('grid'), axis: g('axis'), surface: g('panel'), border: g('rule2'),
    x: g('x'), y: g('y'), z: g('z'), unknown: g('unknown'), accent: g('accent'), good: g('good'), warn: g('warn'), well: g('well'), rule: g('rule'), slots: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => g('s' + i)) };
}

// ---------------- tags and objects ----------------
// A track key is a tag id (number) or 'b:<id>' for a rigid object, which takes its origin tag's colour.
const isBody = (k) => typeof k === 'string' && k.startsWith('b:');
const bodyOf = (k) => S.bodies.find((b) => 'b:' + b.id === k || b.id === k) || null;
const keySort = (a, b) => (isBody(a) - isBody(b)) || String(a).localeCompare(String(b), undefined, { numeric: true });
const parseKey = (v) => (v === '' || v === null || v === undefined ? null : v.startsWith('b:') ? v : +v);
function memberIds() { const m = new Set(); for (const b of S.bodies) for (const x of b.members) m.add(x.id); return m; }
function tagOf(id) { return S.tags.find((t) => t.id === id) || null; }
function slotOf(k) { if (isBody(k)) { const b = bodyOf(k); return b ? slotOf(b.members[0].id) : -1; } const t = tagOf(k); return t ? t.slot : -1; }
function colorOf(k) { const s = slotOf(k); return s >= 0 ? K.slots[s] : K.unknown; }
function cssColorOf(k) { const s = slotOf(k); return s >= 0 ? `var(--s${s + 1})` : 'var(--unknown)'; }
function nameOf(k) { if (isBody(k)) { const b = bodyOf(k); return b ? b.name || 'Object' : k; } const t = tagOf(k); return t && t.name ? t.name : '#' + k; }
function resetTracks() { S.hist.clear(); S.rawHist.clear(); S.filters.clear(); S.tracks.clear(); S.fused.clear(); S.zs.clear(); S.vel.clear(); }
function sizeOf(id) { const t = tagOf(id); return t ? t.size : S.settings.tagSize; }
function freeSlot() { for (let i = 0; i < SLOTS; i++) if (!S.tags.some((t) => t.slot === i)) return i; return -1; }
function addTag(id, name) {
  if (!(Number.isInteger(id) && id >= 0 && id < S.familyCount) || tagOf(id)) return;
  S.tags.push({ id, name: name || '', size: S.settings.tagSize, slot: freeSlot() });
  saveTags(); renderTags(); refreshFrameSel(); refreshTplotSel();
}
function saveTags() { store.set('tags', S.tags); }
function sizesMap() { const m = {}; for (const t of S.tags) m[t.id] = t.size; return m; }

function renderTags() {
  const tb = $('tagRows');
  tb.textContent = '';
  for (const t of S.tags) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><span class="sw" style="background:${cssColorOf(t.id)}" title="${t.slot < 0 ? 'Only 8 colours: this tag is drawn grey, with its name' : ''}"></span></td>
      <td class="mono">${t.id}</td>
      <td><label class="sr" for="tn${t.id}">Name of tag ${t.id}</label><input id="tn${t.id}" class="input sm tagname" maxlength="40" placeholder="Name, e.g. Left hand"></td>
      <td class="num"><span class="field"><label class="sr" for="ts${t.id}">Black square size of tag ${t.id}, mm</label><input id="ts${t.id}" class="input sm num mono" type="number" min="5" max="2000" step="0.5"><span class="unit">mm</span></span></td>
      <td><span class="seen" id="seen${t.id}"><span class="dot"></span><span>Not seen</span></span>${S.bodies.filter((b) => b.members.some((x) => x.id === t.id)).map((b) => `<div class="small muted">in ${escapeHtml(b.name || 'Object')}</div>`).join('')}</td>
      <td style="white-space:nowrap"><button class="btn sm sq" title="Show this tag on a phone" aria-label="Show tag ${t.id} on a phone"><svg class="i"><use href="#i-phone"/></svg></button><button class="btn sm sq" title="Print this tag" aria-label="Print tag ${t.id}"><svg class="i"><use href="#i-print"/></svg></button><button class="btn sm sq danger" title="Remove" aria-label="Remove tag ${t.id}"><svg class="i"><use href="#i-x"/></svg></button></td>`;
    const [nm, sz] = tr.querySelectorAll('input'), [ph, pr, rm] = tr.querySelectorAll('button');
    ph.onclick = () => showTagShare([{ id: t.id, name: t.name }]);
    nm.value = t.name; sz.value = +(t.size * 1000).toFixed(1);
    nm.oninput = () => { t.name = nm.value.trim(); saveTags(); refreshFrameSel(); refreshTplotSel(); };
    sz.onchange = () => { const v = +sz.value; if (v >= 5 && v <= 2000) { t.size = v / 1000; saveTags(); resetTracks(); } else sz.value = +(t.size * 1000).toFixed(1); };
    pr.onclick = () => openPrintDlg({ tags: [t.id], board: false });
    rm.onclick = () => {
      const inBodies = S.bodies.filter((b) => b.members.some((x) => x.id === t.id));
      if (inBodies.length && !confirm(`Tag ${t.id} is part of ${inBodies.map((b) => '“' + (b.name || 'Object') + '”').join(', ')}. Remove the tag and ${inBodies.length > 1 ? 'those objects' : 'that object'}?`)) return;
      S.bodies = S.bodies.filter((b) => !inBodies.includes(b)); saveBodies();
      S.tags = S.tags.filter((x) => x !== t); saveTags(); renderTags(); renderBodies(); refreshFrameSel(); refreshTplotSel();
      if (S.settings.frame === String(t.id) || inBodies.some((b) => S.settings.frame === 'b:' + b.id)) setFrame('camera');
      resetTracks();
    };
    tb.appendChild(tr);
  }
  $('noTags').hidden = S.tags.length > 0;
}
function renderUnknown() {
  const box = $('unknown'), now = performance.now() / 1000;
  const ids = [...S.seen.entries()].filter(([id, s]) => !tagOf(id) && now - s.wall < 3).map(([id]) => id).sort((a, b) => a - b);
  const key = ids.join();
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.querySelectorAll('.chip').forEach((c) => c.remove());
  for (const id of ids) {
    const c = document.createElement('span');
    c.className = 'chip';
    c.innerHTML = `<span class="mono">#${id}</span><button aria-label="Add tag ${id}">Add</button>`;
    c.querySelector('button').onclick = () => { addTag(id); setTimeout(() => { const el = $('tn' + id); if (el) el.focus(); }, 0); };
    box.appendChild(c);
  }
  box.hidden = !ids.length;
}
$('addForm').onsubmit = (e) => {
  e.preventDefault();
  const inp = $('addId'), id = Number(inp.value);
  inp.max = S.familyCount - 1;
  if (inp.value === '' || !Number.isInteger(id) || id < 0 || id >= S.familyCount) {
    inp.setCustomValidity(`Enter a whole number from 0 to ${S.familyCount - 1} (${FAMILY_LABEL[S.settings.family]} has ${S.familyCount} tags).`);
    inp.reportValidity(); return;
  }
  inp.setCustomValidity(''); inp.value = '';
  if (!tagOf(id)) addTag(id);
  setTimeout(() => { const el = $('tn' + id); if (el) el.focus(); }, 0);
};
$('addId').oninput = () => $('addId').setCustomValidity('');

// ---------------- settings inputs ----------------
function bindNum(id, get, set, scale) {
  const el = $(id);
  el.value = +(get() * (scale || 1)).toFixed(3);
  el.onchange = () => { set(+el.value / (scale || 1)); S.settings = C.clampSettings(S.settings); store.set('settings', S.settings); el.value = +(get() * (scale || 1)).toFixed(3); onSettings(); };
}
bindNum('span', () => S.settings.span, (v) => { S.settings.span = v; });
bindNum('every', () => S.settings.every, (v) => { S.settings.every = v; });
bindNum('axisLen', () => S.settings.axisLen, (v) => { S.settings.axisLen = v; }, 100);
bindNum('defSize', () => S.settings.tagSize, (v) => { S.settings.tagSize = v; }, 1000);
bindNum('hfov', () => S.settings.hfov, (v) => { S.settings.hfov = v; });
function onSettings() {
  $('span').value = S.settings.span; $('every').value = S.settings.every;
  S.cams.forEach(updateCam);
}
$('family').value = S.settings.family;
$('family').onchange = () => {
  S.settings.family = $('family').value; store.set('settings', S.settings);
  resetTracks(); S.seen.clear();
  toWorkers({ type: 'family', family: S.settings.family, quality: S.quality });
};
function radios(attr, get, set) {
  const all = document.querySelectorAll(`[data-${attr}]`), paint = () => all.forEach((x) => x.setAttribute('aria-checked', String(x.dataset[attr] === get())));
  all.forEach((b) => { b.onclick = () => { set(b.dataset[attr]); paint(); }; });
  paint();
}
radios('pose', () => S.settings.pose, (v) => { S.settings.pose = v; store.set('settings', S.settings); resetTracks(); paintPoseUi(); renderBodies(); });
radios('motion', () => S.settings.motion, (v) => { S.settings.motion = v; store.set('settings', S.settings); S.filters.clear(); });
function paintPoseUi() {
  $('motionField').hidden = S.settings.pose !== 'filtered';
  $('cmpSw').setAttribute('aria-checked', String(S.settings.compare));
  $('cmpSw').disabled = S.settings.pose === 'raw';
}
$('cmpSw').onclick = () => { S.settings.compare = !S.settings.compare; store.set('settings', S.settings); S.rawHist.clear(); paintPoseUi(); };
document.querySelectorAll('[data-q]').forEach((b) => {
  b.setAttribute('aria-checked', String(b.dataset.q === S.quality));
  b.onclick = () => {
    S.quality = b.dataset.q; store.set('quality', S.quality);
    document.querySelectorAll('[data-q]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    toWorkers({ type: 'family', family: S.settings.family, quality: S.quality });
  };
});
document.querySelectorAll('[data-search]').forEach((b) => {
  b.setAttribute('aria-checked', String(b.dataset.search === S.settings.search));
  b.onclick = () => {
    S.settings.search = b.dataset.search; store.set('settings', S.settings);
    document.querySelectorAll('[data-search]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
  };
});
function refreshFrameSel() {
  const sel = $('frameSel'), cur = S.settings.frame, mem = memberIds();
  sel.innerHTML = '<option value="camera">Camera</option>'
    + S.bodies.map((b) => `<option value="b:${b.id}">${escapeHtml(nameOf('b:' + b.id))} (object)</option>`).join('')
    + S.tags.filter((t) => !mem.has(t.id)).map((t) => `<option value="${t.id}">${escapeHtml(nameOf(t.id))} (#${t.id})</option>`).join('');
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : 'camera';
  if (sel.value !== cur) { S.settings.frame = sel.value; store.set('settings', S.settings); }
}
function setFrame(v) { S.settings.frame = v; store.set('settings', S.settings); resetTracks(); S.tare.clear(); paintTare(); robotReset(); S.view.fitted = false; refreshFrameSel(); refreshTplotSel(); }
// ---------------- tare ----------------
// Re-express a track's stored history under a new tare (null: none), so the trail and the plot change at once.
function retare(key, R0) {
  const old = S.tare.get(key);
  for (const h of [S.hist, S.rawHist]) for (const s of h.get(key)) s.R = C.tared({ R: old ? C.mul3(old, s.R) : s.R, t: s.t }, R0).R;
  if (R0) S.tare.set(key, R0); else S.tare.delete(key);
}
function inView() { const t = performance.now() / 1000; return S.hist.ids().filter((k) => { const s = S.hist.latest(k); return s && t - s.time < 0.5; }); }
function tareNow() {
  for (const key of inView()) { const s = S.hist.latest(key), old = S.tare.get(key); retare(key, old ? C.mul3(old, s.R) : s.R.slice()); }
  paintTare(); lastTable = 0;
}
function clearTare() { for (const key of [...S.tare.keys()]) retare(key, null); paintTare(); lastTable = 0; }
function paintTare() { $('untareBtn').hidden = !S.tare.size; }
$('tareBtn').onclick = tareNow;
$('untareBtn').onclick = clearTare;
$('frameSel').onchange = () => setFrame($('frameSel').value);
// the tracks a visitor can pick: objects, and tags that aren't part of one
function trackKeys() {
  const mem = memberIds();
  return [...new Set([...S.bodies.map((b) => 'b:' + b.id), ...S.tags.map((t) => t.id).filter((id) => !mem.has(id)), ...S.hist.ids()])].sort(keySort);
}
function refreshTplotSel() {
  // not the reference: it always sits at the origin, so there is nothing to plot
  const ref = S.settings.frame === 'camera' ? null : parseKey(S.settings.frame);
  const sel = $('tplotTag'), cur = S.tplotTag, list = trackKeys().filter((k) => k !== ref);
  const key = list.map((k) => k + ':' + nameOf(k)).join('|');
  if (sel.dataset.key !== key) {
    sel.dataset.key = key;
    sel.innerHTML = list.length ? list.map((k) => `<option value="${k}">${escapeHtml(nameOf(k))}${isBody(k) ? '' : tagOf(k) && tagOf(k).name ? ' (#' + k + ')' : ''}</option>`).join('') : '<option value="">No tags</option>';
  }
  if (cur !== null && list.includes(cur)) sel.value = String(cur);
  else if (list.length) { S.tplotTag = list[0]; sel.value = String(list[0]); }
}
document.querySelectorAll('[data-tp]').forEach((b) => {
  b.setAttribute('aria-checked', String(b.dataset.tp === S.tplotMode));
  b.onclick = () => { S.tplotMode = b.dataset.tp; store.set('tplotMode', S.tplotMode); RB.jointsT = 0; paintTplotMode(); };
});
// The arms the robot has now (with a track), left first; Joint angles is offered only while it has one.
const robotArms = () => (S.settings.show3d === 'robot' && RB.scene ? RB.scene.arms.filter((a) => a.key !== null && a.key !== undefined).sort((a, b) => b.side - a.side) : []);
// The hands on the table (left first); Forces is offered only while there is one.
const forceSides = () => (S.settings.show3d === 'robot' && TB.world ? [...RB.fhist.keys()].sort((a, b) => b - a) : []);
const tpMode = () => (S.tplotMode === 'joints' && !robotArms().length ? 'velocity' : S.tplotMode === 'forces' && !forceSides().length ? 'velocity' : S.tplotMode);
function paintTplotMode() {
  const mode = tpMode(), arms = robotArms(), fs = forceSides();
  $('tpJoints').hidden = !arms.length; $('tpForces').hidden = !fs.length;
  document.querySelectorAll('[data-tp]').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.tp === mode)));
  const j = mode === 'joints', fo = mode === 'forces', sides = j ? arms.map((a) => a.side) : fs;
  $('tplotTag').hidden = j || fo; $('jointArm').hidden = !(j || fo); $('jointsNow').hidden = !j; $('forcesNow').hidden = !fo; $('tagsNow').hidden = j || fo;
  if (j || fo) {
    if (!sides.includes(S.jointSide)) S.jointSide = sides[0];
    const opts = sides.map((sd) => `<option value="${sd}">${sd === 1 ? 'Left' : 'Right'} ${j ? 'arm' : 'hand'}</option>`).join('');
    if ($('jointArm').dataset.key !== opts) { $('jointArm').dataset.key = opts; $('jointArm').innerHTML = opts; }
    $('jointArm').value = String(S.jointSide);
  }
  tplot.setAttribute('aria-label', { quat: 'The chosen tag’s orientation over the history, as a unit quaternion w, x, y, z', position: 'x, y and z of the chosen tag over the history, in centimetres', velocity: 'The chosen tag’s velocity along x, y and z over the history, in cm/s', joints: 'The chosen arm’s seven joint angles over the history, in degrees', forces: 'The forces on the chosen hand over the history, in newtons: its squeeze, what that squeeze can hold, the grip’s load and everything else it touches' }[mode]);
}
$('jointArm').onchange = () => { S.jointSide = +$('jointArm').value; };
// click a row of the Now table to plot that track
$('nowRows').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-key]');
  if (!tr) return;
  S.tplotTag = parseKey(tr.dataset.key); refreshTplotSel();
  $('nowRows').querySelectorAll('tr[data-key]').forEach((r) => r.setAttribute('aria-selected', String(r === tr)));
});
$('tplotTag').onchange = () => { S.tplotTag = parseKey($('tplotTag').value); };
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

// ---------------- status ----------------
// An empty text hides it: nothing to say while the page waits for Start.
function status(text, kind) {
  $('status').hidden = !text;
  $('statusText').textContent = text || '';
  $('status').className = 'pill ' + (kind || '');
}
