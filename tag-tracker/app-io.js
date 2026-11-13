// Tag tracker page, part of index.html's script: Stream, recording and notes, voice.
// The app-*.js files are classic scripts loaded in order and share one global scope; nothing in them runs
// another file's code at load (the boot script at the end of index.html starts everything).
'use strict';

// ---------------- stream: the poses, sent on over serial or UDP ----------------
// After each detection, at most `rate` times a second: one message (TagCore.streamMessage) with the newest plotted
// pose of every track in view, so it is in the Track tab's frame and tare. It goes to the serial port (Web Serial) and
// to the UDP bridge (a WebSocket to udp-bridge.py on this computer, which sends each message as one datagram). A
// message that finds the last one still being written is dropped, not queued, so the link never falls behind.
const ST = Object.assign({ fmt: 'json', rate: 30, baud: 115200, host: '127.0.0.1', port: 9870, bridge: 8770 }, store.get('stream', {}));
ST.fmt = ST.fmt === 'csv' ? 'csv' : 'json';
if (![10, 30, 60, 0].includes(ST.rate)) ST.rate = 30;
if (![9600, 57600, 115200, 230400, 460800, 921600].includes(ST.baud)) ST.baud = 115200;
for (const [k, d] of [['port', 9870], ['bridge', 8770]]) if (!(Number.isInteger(ST[k]) && ST[k] >= 1 && ST[k] <= 65535)) ST[k] = d;
if (typeof ST.host !== 'string' || !ST.host) ST.host = '127.0.0.1';
const stLive = { last: 0, sent: 0, dropped: 0, msg: '', serial: null, ws: null, painted: 0 };
const enc = new TextEncoder();
function saveStream() { store.set('stream', { fmt: ST.fmt, rate: ST.rate, baud: ST.baud, host: ST.host, port: ST.port, bridge: ST.bridge }); }
function frameName() { return S.settings.frame === 'camera' ? 'camera' : nameOf(parseKey(S.settings.frame)); }
function streamTick(time) {
  const wall = performance.now();
  if (ST.rate && wall - stLive.last < 1000 / ST.rate - 2) return;
  stLive.last = wall;
  const rows = [];
  for (const key of S.hist.ids().sort(keySort)) {
    const s = S.hist.latest(key);
    if (s && time - s.time < 0.25) rows.push({ track: key, name: nameOf(key), p: s.t, q: C.quatOf(s.R) });
  }
  const msg = C.streamMessage(ST.fmt, performance.timeOrigin / 1000 + time, rows, frameName(), 'in person');
  if (msg) stLive.msg = msg;
  if (msg) send(msg);
}
function send(msg) {
  const sp = stLive.serial, ws = stLive.ws;
  let out = false;
  if (sp && sp.writer) {
    if (sp.busy) stLive.dropped++;
    else { sp.busy = true; out = true; sp.writer.write(enc.encode(msg)).then(() => { sp.busy = false; }, (e) => serialGone(e)); }
  }
  if (ws && ws.ok && ws.sock.readyState === 1) {
    if (ws.sock.bufferedAmount > 65536) stLive.dropped++;
    else { ws.sock.send(msg); out = true; }
  }
  if (out) stLive.sent++;
}
const header = () => (ST.fmt === 'csv' ? C.STREAM_CSV_HEADER + '\n' : '');
function note(id, text, warn) { $(id).innerHTML = text ? `<div class="note${warn ? ' warn' : ''}"><svg class="i"><use href="#i-${warn ? 'alert' : 'info'}"/></svg><span>${text}</span></div>` : ''; }
function stState(id, on, text) { const el = $(id); el.classList.toggle('on', on); el.lastElementChild.textContent = text; }
// serial
async function serialConnect() {
  if (stLive.serial) return serialClose();
  if (!('serial' in navigator)) return note('stSerialMsg', 'This browser has no Web Serial. Use Chrome or Edge on a computer, or send over UDP.', true);
  let port;
  try { port = await navigator.serial.requestPort(); } catch (e) { return; } // closed the chooser
  try { await port.open({ baudRate: ST.baud }); } catch (e) { return note('stSerialMsg', `Couldn’t open the port (${escapeHtml(e.message)}). Is another program using it?`, true); }
  const sp = { port, writer: port.writable.getWriter(), busy: false };
  stLive.serial = sp;
  if (header()) sp.writer.write(enc.encode(header())).catch(() => {});
  const info = port.getInfo ? port.getInfo() : {};
  stState('stSerialState', true, `Sending at ${ST.baud} baud${info.usbVendorId ? ` (USB ${info.usbVendorId.toString(16).padStart(4, '0')}:${(info.usbProductId || 0).toString(16).padStart(4, '0')})` : ''}`);
  $('stSerialBtn').textContent = 'Disconnect'; $('stBaud').disabled = true; note('stSerialMsg', '');
}
async function serialClose() {
  const sp = stLive.serial;
  if (!sp) return;
  stLive.serial = null;
  try { await sp.writer.close(); } catch (e) { /* already gone */ }
  try { sp.writer.releaseLock(); } catch (e) { /* released */ }
  try { await sp.port.close(); } catch (e) { /* unplugged */ }
  stState('stSerialState', false, 'Not connected'); $('stSerialBtn').textContent = 'Connect a port'; $('stBaud').disabled = false;
}
function serialGone(e) {
  if (!stLive.serial) return;
  serialClose();
  note('stSerialMsg', `The port closed${e && e.message ? ` (${escapeHtml(e.message)})` : ''}. Was it unplugged?`, true);
}
if ('serial' in navigator) navigator.serial.addEventListener('disconnect', (e) => { if (stLive.serial && e.target === stLive.serial.port) serialGone(); });
// UDP, through the bridge
function bridgeCmd() {
  const o = location.origin, ok = o === 'https://tsmorz.github.io' || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(o);
  return 'python3 udp-bridge.py' + (ST.bridge !== 8770 ? ` --port ${ST.bridge}` : '') + (ok ? '' : ` --origin ${o}`);
}
function udpConnect() {
  if (stLive.ws) return udpClose();
  const to = `${ST.host.includes(':') ? `[${ST.host}]` : ST.host}:${ST.port}`;
  let sock;
  try { sock = new WebSocket(`ws://127.0.0.1:${ST.bridge}/?to=${encodeURIComponent(to)}`); } catch (e) { return note('stUdpMsg', escapeHtml(e.message), true); }
  const ws = { sock, ok: false };
  stLive.ws = ws;
  stState('stUdpState', false, 'Connecting…'); $('stUdpBtn').textContent = 'Disconnect'; note('stUdpMsg', '');
  sock.onmessage = (ev) => {
    let m = null;
    try { m = JSON.parse(ev.data); } catch (e) { /* not the bridge */ }
    if (!m || m.bridge !== 'tag-tracker-udp' || ws.ok) return;
    ws.ok = true;
    if (header()) sock.send(header());
    stState('stUdpState', true, `Sending to ${m.to}`);
  };
  sock.onclose = () => {
    if (stLive.ws !== ws) return;
    stLive.ws = null;
    stState('stUdpState', false, 'Not connected'); $('stUdpBtn').textContent = 'Connect';
    note('stUdpMsg', ws.ok ? 'The bridge closed the connection.' : `No bridge answered on port ${ST.bridge}. Start it with the command above, and if the browser asks, allow this page to reach devices on your local network.`, true);
  };
}
function udpClose() { const ws = stLive.ws; stLive.ws = null; if (ws) ws.sock.close(); stState('stUdpState', false, 'Not connected'); $('stUdpBtn').textContent = 'Connect'; }
// the panel
function paintStream() {
  const now = performance.now();
  if (now - stLive.painted < 250) return;
  stLive.painted = now;
  $('stPreview').textContent = stLive.msg ? (ST.fmt === 'csv' ? header() : '') + stLive.msg.replace(/\n$/, '') : (S.running ? 'No tracks in view.' : 'Start a camera, or the demo, to see messages here.');
  const linked = stLive.serial || (stLive.ws && stLive.ws.ok);
  $('stCount').textContent = linked || stLive.sent ? `${stLive.sent.toLocaleString()} sent${stLive.dropped ? `, ${stLive.dropped.toLocaleString()} dropped: the link is slower than the rate` : ''}` : '';
}
function paintStreamForm() {
  document.querySelectorAll('[data-stfmt]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.stfmt === ST.fmt)));
  $('stRate').value = String(ST.rate); $('stBaud').value = String(ST.baud);
  $('stHost').value = ST.host; $('stPort').value = ST.port; $('stBridge').value = ST.bridge;
  $('stCmd').textContent = bridgeCmd();
}
document.querySelectorAll('[data-stfmt]').forEach((b) => b.onclick = () => {
  ST.fmt = b.dataset.stfmt; saveStream(); paintStreamForm(); stLive.msg = '';
  if (header()) send(header()); // the receiver gets the column names before the first CSV line
});
$('stRate').onchange = () => { ST.rate = +$('stRate').value; saveStream(); };
$('stBaud').onchange = () => { ST.baud = +$('stBaud').value; saveStream(); };
$('stHost').onchange = () => { ST.host = $('stHost').value.trim() || '127.0.0.1'; saveStream(); paintStreamForm(); };
const portIn = (id, k, d) => { $(id).onchange = () => { const v = Math.round(+$(id).value); ST[k] = v >= 1 && v <= 65535 ? v : d; saveStream(); paintStreamForm(); }; };
portIn('stPort', 'port', 9870); portIn('stBridge', 'bridge', 8770);
$('stSerialBtn').onclick = serialConnect;
$('stUdpBtn').onclick = udpConnect;
$('stCopy').onclick = () => { navigator.clipboard.writeText(bridgeCmd()).then(() => { $('stCopy').textContent = 'Copied'; setTimeout(() => { $('stCopy').textContent = 'Copy'; }, 1500); }, () => {}); };
paintStreamForm();

// ---------------- recording and notes ----------------
// Record keeps every new plotted pose (each track's sample from each detection, once), in the Track tab's frame, tare
// and view, as the Stream card would send it. The notes box belongs to the recording: one line per note, and while
// recording each new line starts with the time it was begun (typed or spoken; TagCore.parseNotes reads them back).
// Notes written before the first recording stay as notes about it; a new recording after that starts with an empty box.
const REC_MAX_S = 3600, REC_MAX_POSES = 600000;
const REC = { on: false, rec: null, saved: true, t0: 0, painted: 0 };
const notesEl = $('notes');
const recNow = () => performance.now() / 1000 - REC.t0; // seconds since the recording began
function recStart() {
  if (REC.on) return true;
  if (REC.rec && REC.rec.poses && !REC.saved && !confirm('Start a new recording? The last one hasn’t been downloaded, and it will be lost with its notes.')) return false;
  if (REC.rec) notesEl.value = '';
  REC.t0 = performance.now() / 1000;
  REC.rec = { start: performance.timeOrigin / 1000 + REC.t0, end: 0, samples: [], poses: 0, tracks: new Set(), why: '' };
  REC.on = true; REC.saved = true;
  paintRecUi();
  return true;
}
function recStop(why) {
  if (!REC.on) return;
  REC.on = false;
  REC.rec.end = performance.timeOrigin / 1000 + performance.now() / 1000;
  REC.rec.why = why || '';
  paintRecUi();
}
function recTick(time) {
  if (!REC.on || time < REC.t0) return;
  const rows = [];
  for (const key of S.hist.ids().sort(keySort)) {
    const s = S.hist.latest(key);
    if (s && s.time === time) rows.push({ track: key, name: nameOf(key), p: s.t.slice(), q: C.quatOf(s.R) });
  }
  if (!rows.length) return;
  const r = REC.rec;
  r.samples.push({ t: performance.timeOrigin / 1000 + time, frame: frameName(), view: 'in person', rows });
  r.poses += rows.length;
  for (const x of rows) r.tracks.add(x.track);
  REC.saved = false;
  if (r.poses >= REC_MAX_POSES) recStop('full');
}
function recSummary() {
  const r = REC.rec;
  if (!r) return 'Records every pose the Track tab plots, with your notes.';
  const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
  const notes = C.parseNotes(notesEl.value).length;
  const what = r.poses ? `${plural(r.poses, 'pose')} of ${plural(r.tracks.size, 'track')}` : REC.on && !S.running ? 'start a camera or the demo' : 'nothing in view yet';
  const why = r.why === 'full' ? ' (stopped: that’s as many poses as one recording holds)' : r.why === 'long' ? ' (stopped after an hour)' : '';
  return `${C.fmtStamp(REC.on ? recNow() : r.end - r.start)}${REC.on ? '' : ' recorded'}: ${what}${notes ? `, ${plural(notes, 'note')}` : ''}${why}`;
}
function paintRec() {
  const now = performance.now();
  if (REC.on && recNow() > REC_MAX_S) recStop('long');
  if (now - REC.painted < 250) return;
  REC.painted = now;
  $('recText').textContent = recSummary();
}
function paintRecUi() {
  const b = $('recBtn');
  b.setAttribute('aria-pressed', String(REC.on));
  b.querySelector('use').setAttribute('href', REC.on ? '#i-stop' : '#i-rec');
  b.querySelector('span').textContent = REC.on ? 'Stop' : 'Record';
  $('recInfo').classList.toggle('on', REC.on);
  $('recCsv').disabled = $('recJson').disabled = !REC.rec || REC.on;
  $('recDiscard').disabled = !REC.rec && !notesEl.value;
  REC.painted = 0; paintRec();
}
function recFile(ext) {
  const d = new Date(REC.rec.start * 1000), p = (x) => String(x).padStart(2, '0');
  return `tag-recording-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
}
$('recBtn').onclick = () => { if (REC.on) recStop(); else recStart(); };
$('recCsv').onclick = () => { download(new Blob([C.recordingCsv(REC.rec, C.parseNotes(notesEl.value))], { type: 'text/csv' }), recFile('csv')); REC.saved = true; };
$('recJson').onclick = () => { download(new Blob([C.recordingJson(REC.rec, C.parseNotes(notesEl.value))], { type: 'application/json' }), recFile('json')); REC.saved = true; };
$('recDiscard').onclick = () => {
  if (REC.rec && REC.rec.poses && !REC.saved && !confirm('Discard this recording and its notes? It hasn’t been downloaded.')) return;
  REC.on = false; REC.rec = null; REC.saved = true; notesEl.value = '';
  paintRecUi();
};
// While recording, the first thing typed on an empty line puts the time in front of it.
notesEl.addEventListener('beforeinput', (e) => {
  if (!REC.on || e.inputType !== 'insertText' || !e.data || !e.data.trim()) return;
  const v = notesEl.value, a = notesEl.selectionStart, b = notesEl.selectionEnd;
  const ls = v.lastIndexOf('\n', a - 1) + 1;
  let le = v.indexOf('\n', b); if (le < 0) le = v.length;
  if (v.slice(ls, a).trim() || v.slice(b, le).trim()) return;
  e.preventDefault();
  notesEl.setRangeText(`${C.fmtStamp(recNow())}  ${e.data}`, ls, le, 'end');
  notesEl.dispatchEvent(new Event('input', { bubbles: true }));
});
notesEl.addEventListener('input', () => { if (REC.rec && REC.rec.poses) REC.saved = false; $('recDiscard').disabled = !REC.rec && !notesEl.value; REC.painted = 0; paintRec(); });
window.addEventListener('beforeunload', (e) => { if (REC.rec && REC.rec.poses && !REC.saved) { e.preventDefault(); e.returnValue = ''; } });
// A spoken note: a new timed line at the end while recording (timed from when you began speaking), else at the caret.
function addNote(text, at) {
  const v = notesEl.value;
  if (REC.on) {
    notesEl.value = v + (v === '' || v.endsWith('\n') ? '' : '\n') + `${C.fmtStamp(Math.max(0, at - REC.t0))}  ${text}`;
    notesEl.setSelectionRange(notesEl.value.length, notesEl.value.length);
    notesEl.scrollTop = notesEl.scrollHeight;
  } else {
    const r = C.insertSpeech(v, notesEl.selectionStart, notesEl.selectionEnd, text);
    notesEl.value = r.value; notesEl.setSelectionRange(r.caret, r.caret);
  }
  notesEl.dispatchEvent(new Event('input', { bubbles: true }));
}
paintRecUi();

// ---------------- voice: notes and commands, spoken ----------------
// Press V (outside a text box), the top bar's microphone or Dictate, and speak; the take ends after a pause
// (TagCore.VoiceGate), or press again, or Escape. MediaRecorder records the microphone; the clip is decoded to 16 kHz
// mono (an OfflineAudioContext resamples it) and speech-worker.js turns it into text with Whisper tiny.en, on this
// computer. An utterance that is a command as a whole (TagCore.voiceCommand) runs it; anything else becomes a note.
// The model downloads on first use (you can speak meanwhile: the take waits for it), then comes from the cache.
const SR = 16000, MAX_TAKE_S = 60, SILENCE_RMS = 0.004;
const V = { worker: null, ready: false, failed: '', progress: 0, rec: null, stream: null, chunks: [], at: null, pressAt: 0, none: false, ctx: null, raf: 0, stopT: 0, hideT: 0, job: 0, pending: new Map(), opening: false };
const voiceOk = window.isSecureContext && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && 'MediaRecorder' in window && 'OfflineAudioContext' in window;
const VOICE_ACTIONS = {
  track: () => { setMode('track'); return 'Track tab'; },
  calib: () => { setMode('calib'); return 'Calibrate tab'; },
  stream: () => { setMode('track'); $('streamCard').scrollIntoView({ behavior: 'smooth', block: 'start' }); return 'Stream'; },
  record: () => (REC.on ? 'Already recording' : recStart() ? 'Recording' : 'Kept the last recording'),
  stop: () => (REC.on ? (recStop(), 'Recording stopped') : 'Not recording'),
  tare: () => { tareNow(); return 'Orientation tared'; },
  untare: () => { clearTare(); return 'Tare cleared'; },
  fit: () => { if (S.tab !== 'track') setMode('track'); fitView(); return 'View fitted'; },
  reset: () => { if (S.tab !== 'track') setMode('track'); resetView(); return 'View reset'; },
  robot: () => { if (S.tab !== 'track') setMode('track'); if (S.settings.show3d !== 'robot') document.querySelector('[data-show3d="robot"]').click(); return calibrateRobot(); },
  settings: () => { openSettings(); return 'Settings'; },
  table: () => { if (S.tab !== 'track') setMode('track'); return resetTable(); },
  sound: () => setSound(true),
  mute: () => setSound(false),
};
function voiceSay(state, text, hold) {
  const el = $('voice');
  el.dataset.state = state; $('voiceText').textContent = text; el.hidden = false;
  clearTimeout(V.hideT);
  if (hold) V.hideT = setTimeout(() => { el.hidden = true; el.dataset.state = 'idle'; }, hold);
  const on = state === 'listening';
  for (const id of ['voiceBtn', 'dictBtn']) { $(id).setAttribute('aria-pressed', String(on)); $(id).disabled = state === 'processing'; }
  duckSound();
  $('dictBtn').querySelector('span').textContent = on ? 'Stop' : 'Dictate';
}
function speechWorker() {
  if (V.worker) return;
  const base = /\/$|\.html?$/.test(location.pathname) ? '' : location.pathname + '/';
  V.worker = new Worker(base + 'speech-worker.js?v=40a2f428', { type: 'module' });
  const fail = (msg) => { V.failed = msg; for (const f of V.pending.values()) f({ error: msg }); V.pending.clear(); };
  V.worker.onmessage = ({ data: d }) => {
    if (d.type === 'progress') {
      if (d.file === undefined) V.sawTotal = true; // overall progress: once it comes, the per-file figures would make it jump
      else if (V.sawTotal) return;
      V.progress = d.value;
      if (!V.ready && $('voice').dataset.state === 'processing') voiceSay('processing', `Downloading the speech model, ${Math.round(d.value)}% (only the first time)…`);
    } else if (d.type === 'ready') V.ready = true;
    else if (d.type === 'error') fail(`the speech model could not load: ${d.message}`);
    else if (d.type === 'result') { const f = V.pending.get(d.id); V.pending.delete(d.id); if (f) f(d); }
  };
  V.worker.onerror = (e) => fail(e.message || 'the speech worker failed');
  V.worker.postMessage({ type: 'load' });
}
function transcribe(audio) {
  if (V.failed) return Promise.reject(new Error(V.failed));
  const id = ++V.job;
  return new Promise((resolve, reject) => {
    V.pending.set(id, (d) => (d.error ? reject(new Error(d.error)) : resolve(d.text)));
    V.worker.postMessage({ type: 'transcribe', id, audio }, [audio.buffer]);
  });
}
const rmsOf = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / (a.length || 1)); };
async function voiceStart() {
  if (V.rec || V.opening || $('voice').dataset.state === 'processing') return;
  if (!voiceOk) { voiceSay('error', 'This browser can’t record audio here: it needs HTTPS and MediaRecorder.', 6000); return; }
  if (V.failed) { V.worker.terminate(); V.worker = null; V.failed = ''; V.ready = false; } // try again
  speechWorker();
  V.opening = true;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) {
    V.opening = false;
    const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    voiceSay('error', denied ? 'Microphone access was blocked. Allow it in the address bar and try again.' : `No microphone (${e.message}).`, 6000);
    return;
  }
  V.opening = false;
  V.stream = stream; V.chunks = []; V.at = null; V.none = false; V.pressAt = performance.now();
  V.rec = new MediaRecorder(stream);
  V.rec.ondataavailable = (e) => { if (e.data.size) V.chunks.push(e.data); };
  V.rec.onstop = voiceFinish;
  V.rec.start();
  listen(stream);
  V.stopT = setTimeout(voiceStop, MAX_TAKE_S * 1000);
  const say = 'say a command (“Calibrate robot”, “Start recording”, “Tare”) or a note';
  voiceSay('listening', V.ready ? `Listening: ${say}…` : `Listening: ${say} (the speech model downloads meanwhile)…`);
}
// The level meter, and the gate that ends the take after a pause.
function listen(stream) {
  const ctx = new AudioContext(), an = ctx.createAnalyser();
  an.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(an);
  const buf = new Float32Array(an.fftSize), gate = new C.VoiceGate();
  gate.reset(performance.now());
  V.ctx = ctx;
  const tick = () => {
    an.getFloatTimeDomainData(buf);
    const level = rmsOf(buf), ev = gate.step(level, performance.now());
    $('voiceMeter').style.transform = `scaleX(${Math.min(1, level * 6)})`;
    if (ev === 'start') V.at = gate.start;
    if (ev === 'end' || ev === 'none') { V.none = ev === 'none'; voiceStop(); return; }
    V.raf = requestAnimationFrame(tick);
  };
  tick();
}
function voiceStop() {
  clearTimeout(V.stopT); cancelAnimationFrame(V.raf);
  if (V.rec && V.rec.state !== 'inactive') V.rec.stop();
}
async function voiceFinish() {
  cancelAnimationFrame(V.raf); $('voiceMeter').style.transform = 'scaleX(0)';
  if (V.ctx) { V.ctx.close(); V.ctx = null; }
  V.stream.getTracks().forEach((t) => t.stop());
  const blob = new Blob(V.chunks, { type: V.rec.mimeType }), at = (V.at === null ? V.pressAt : V.at) / 1000, none = V.none;
  V.rec = null; V.stream = null; V.chunks = [];
  if (none) { voiceSay('done', 'Didn’t hear anything. Try again a little closer to the microphone.', 4000); return; }
  voiceSay('processing', V.ready ? 'Turning speech into text…' : `Downloading the speech model${V.progress ? `, ${Math.round(V.progress)}%` : ''} (only the first time)…`);
  try {
    const audio = await toMono16k(blob);
    // Whisper invents words in silence, so a quiet take is dropped
    if (rmsOf(audio) < SILENCE_RMS) { voiceSay('done', 'Didn’t hear anything. Try again a little closer to the microphone.', 4000); return; }
    const text = C.tidySpeech(await transcribe(audio));
    if (!text) { voiceSay('done', 'No words recognised. Try again.', 4000); return; }
    const c = C.voiceCommand(text);
    if (c && c.cmd !== 'note') voiceSay('done', `“${text.replace(/[.!?]$/, '')}”: ${VOICE_ACTIONS[c.cmd]()}.`, 4000);
    else {
      const note = c ? c.text : text;
      addNote(note, at);
      voiceSay('done', `${REC.on ? 'Note at ' + C.fmtStamp(Math.max(0, at - REC.t0)) : 'Note'}: “${note}”`, 5000);
    }
  } catch (e) {
    voiceSay('error', `Couldn’t turn that into text (${e.message}).`, 7000);
  }
}
// Whatever the recorder made (webm/opus, mp4/aac), decoded at 16 kHz, which resamples it, and mixed down to one channel.
async function toMono16k(blob) {
  const buf = await new OfflineAudioContext(1, SR, SR).decodeAudioData(await blob.arrayBuffer());
  if (buf.numberOfChannels === 1) return buf.getChannelData(0).slice();
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) { const ch = buf.getChannelData(c); for (let i = 0; i < out.length; i++) out[i] += ch[i] / buf.numberOfChannels; }
  return out;
}
const voiceToggle = () => { if (V.rec) voiceStop(); else voiceStart(); };
$('voiceBtn').onclick = voiceToggle;
$('dictBtn').onclick = voiceToggle;
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && V.rec) { voiceStop(); return; }
  if ((e.key !== 'v' && e.key !== 'V') || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable], dialog[open]')) return;
  if (!$('boardView').hidden) return;
  e.preventDefault(); voiceToggle();
});
window.addEventListener('pagehide', () => {
  if (!V.rec) return;
  V.rec.onstop = null; voiceStop();
  if (V.stream) V.stream.getTracks().forEach((t) => t.stop());
  if (V.ctx) V.ctx.close();
});
