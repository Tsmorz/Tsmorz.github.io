// Tag tracker page, part of index.html's script: motion sensors: nrf-controller boards over Bluetooth.
// The app-*.js files are classic scripts loaded in order and share one global scope; nothing in them runs
// another file's code at load (the boot script at the end of index.html starts everything).
'use strict';

// ---------------- motion sensors: nrf-controller boards over Bluetooth ----------------
// A board (a XIAO nRF54LM20A Sense running nrf-controller) notifies its IMU in batches of up to 8 samples at 208 Hz
// (TagCore.decodeImuBatch). Its clock is put on the page's (TagCore.BoardClock), and each sample is kept for 1.5 s:
// its time, VQF's orientation Q (IMU → VQF's world, z up) and the gyro in rad/s with VQF's bias estimate taken off.
// A board is fixed to one track. Lining it up (TagCore.lineUp) learns M, how it sits on the track (kept per board),
// and W, VQF's world in the rig (per connection: VQF's heading is free and drifts), from the cameras' own poses of the
// track (noteCamPose) paired with the board's orientation at the same moment. W's heading then follows the cameras
// slowly. Once lined up, each batch gives the track's Kalman filter (Filtered poses only) the gyro, turned into the
// rig, and VQF's tilt (W·Q·M, loose about world up).
const BOARD_RATE_SIGMA = 0.03, BOARD_TILT_SIGMA = 0.02, BOARD_UP_SIGMA = 0.5; // rad/s, rad, rad
const HAS_BT = !!(navigator.bluetooth && navigator.bluetooth.requestDevice);
S.boards = [];
const boardStore = {
  get: () => store.get('boards', {}),
  save(b) { const all = store.get('boards', {}); all[b.id] = { track: b.track, M: b.M, use: b.use, rms: b.rms, grip: b.grip, hapticSide: b.hapticSide }; store.set('boards', all); },
};
const camPoses = new Map();
function noteCamPose(key, time, R) {
  if (!S.boards.some((b) => b.track === key)) return;
  let a = camPoses.get(key);
  if (!a) camPoses.set(key, (a = []));
  a.push({ time, R });
  while (a.length && time - a[0].time > 1.5) a.shift();
}
function newBoard(id, name, extra) {
  const saved = boardStore.get()[id] || {};
  const b = Object.assign({
    id, name, device: null, sim: false, info: null, clock: new C.BoardClock(), buf: [], track: saved.track === undefined ? null : saved.track,
    M: saved.M || null, rms: saved.rms == null ? null : saved.rms, use: saved.use !== false, W: null, pairs: [], wPairs: [], pairT: -Infinity,
    state: 'connecting', err: '', lastSeq: null, lost: 0, n: 0, nPrev: 0, rate: 0, rateT: performance.now(), fit: null, learn: '',
    hapticSide: ['1','-1','off'].includes(saved.hapticSide) ? saved.hapticSide : 'auto', hapticCharacteristic: null,
    grip: saved.grip || null, act: null, actT: 0, actOk: null, // the gripper servo: {open, closed} in permille, its last status, whether it can be read
  }, extra || {});
  S.boards.push(b);
  renderBoards();
  return b;
}
// one batch from a board, `arrival` on the page's clock (s)
function onBatch(b, view, arrival) {
  const d = C.decodeImuBatch(view);
  if (!d || !b.info) return;
  if (b.lastSeq !== null) { const gap = (d.firstSeq - b.lastSeq - 1) >>> 0; if (gap < 100000) b.lost += gap; }
  b.lastSeq = (d.firstSeq + d.samples.length - 1) >>> 0;
  const ext = d.samples.map((x) => b.clock.unwrap(x.tUs));
  b.clock.add(ext[ext.length - 1], arrival);
  const k = (b.info.gyroDpsPerLsb * Math.PI) / 180, bias = d.biasDps.map((x) => (x * Math.PI) / 180);
  d.samples.forEach((x, i) => b.buf.push({ t: b.clock.toHost(ext[i]), Q: C.rotOfQuat(x.q), w: x.gyro.map((v, j) => v * k - bias[j]) }));
  const tn = b.buf[b.buf.length - 1].t;
  while (tn - b.buf[0].t > 1.5) b.buf.shift();
  b.n += d.samples.length;
  boardLineUp(b);
  boardFuse(b, d.samples.length);
}
// the board's orientation at page time t, between the samples either side
function imuAt(b, t) {
  const a = b.buf;
  for (let i = a.length - 1; i > 0; i--) {
    if (a[i - 1].t > t) continue;
    if (a[i].t < t) return null;
    const f = (t - a[i - 1].t) / Math.max(1e-6, a[i].t - a[i - 1].t), Q0 = a[i - 1].Q;
    return C.mul3(Q0, C.rodrigues(C.so3Log(C.mul3(C.tr3(Q0), a[i].Q)).map((x) => x * f)));
  }
  return null;
}
// pair each camera pose of the track with the board's orientation then, once the board's data has caught up with it
function boardLineUp(b) {
  if (b.track === null || !b.buf.length) return;
  const last = b.buf[b.buf.length - 1].t;
  for (const c of camPoses.get(b.track) || []) {
    if (c.time <= b.pairT || c.time > last) continue;
    b.pairT = c.time;
    const Q = imuAt(b, c.time);
    if (Q) pairUp(b, c.R, Q, c.time);
  }
}
function pairUp(b, Rc, Q, time) {
  if (!b.M) { // learning how it sits: poses 0.1 s apart, tried every 5 once there are 20
    if (b.pairs.length && time - b.pairs[b.pairs.length - 1].time < 0.1) return;
    b.pairs.push({ Rc, Q, time });
    if (b.pairs.length > 90) b.pairs.shift();
    if (b.pairs.length >= 20 && b.pairs.length % 5 === 0) {
      const L = C.lineUp(b.pairs);
      b.learn = L.error || '';
      if (!L.error && L.rms < (3 * Math.PI) / 180 && L.used >= 15) { b.M = L.M; b.W = L.W; b.rms = L.rms; b.fit = L.rms; b.pairs = []; boardStore.save(b); renderBoards(); }
      else if (!L.error) b.learn = 'fit';
    }
    return;
  }
  const Wobs = C.mul3(Rc, C.mul3(C.tr3(b.M), C.tr3(Q)));
  if (!b.W) { // finding VQF's heading in the rig, with M known: the mean of 8 poses' worth
    b.wPairs.push({ R: Wobs, t: [0, 0, 0] });
    if (b.wPairs.length < 8) return;
    const mp = C.meanPose(b.wPairs, 10, 1);
    if (mp.used >= 5) { b.W = mp.R; b.fit = null; b.wPairs = []; } else b.wPairs.shift();
    return;
  }
  // lined up: follow VQF's heading as it drifts (a turn about world up), slowly, and keep score
  const dW = C.so3Log(C.mul3(Wobs, C.tr3(b.W))), err = C.norm(dW), up = C.mulv(b.W, [0, 0, 1]);
  b.fit = b.fit == null ? err : 0.95 * b.fit + 0.05 * err;
  if (err < 0.2) { const along = dW[0] * up[0] + dW[1] * up[1] + dW[2] * up[2]; b.W = C.mul3(C.rodrigues(up.map((x) => x * 0.05 * along)), b.W); }
  if (b.fit > (10 * Math.PI) / 180) { b.W = null; b.fit = null; } // lost its heading (the board restarted?): find it again
}
// a lined-up board's batch into its track's filter: the batch's mean turn rate, and its last orientation's tilt
function boardFuse(b, n) {
  if (!b.use || !b.M || !b.W || b.track === null || S.settings.pose !== 'filtered') return;
  const f = S.filters.get(b.track);
  if (!f || !f.x) return;
  const fresh = b.buf.slice(-n), w = [0, 0, 0];
  let tm = 0;
  for (const x of fresh) { const v = C.mulv(C.mul3(b.W, x.Q), x.w); for (let i = 0; i < 3; i++) w[i] += v[i] / n; tm += x.t / n; }
  f.updateRate(tm, w, BOARD_RATE_SIGMA);
  const L = fresh[fresh.length - 1], r = f.updateTilt(L.t, C.mul3(b.W, C.mul3(L.Q, b.M)), C.mulv(b.W, [0, 0, 1]), BOARD_TILT_SIGMA, BOARD_UP_SIGMA);
  if (r) { b.fused = (b.fused || 0) + 1; if (r.rejected) b.rejected = (b.rejected || 0) + 1; }
}

// Bluetooth: Chrome and Edge. The first read needs an encrypted, authenticated link, so a board that isn't bonded yet
// makes the system ask for its six-digit code (the board prints it on its USB console). A board that drops is tried
// again a few times.
function idOf(device) { const m = /([0-9A-F]{4})$/i.exec(device.name || ''); return m ? m[1].toUpperCase() : String(device.id).slice(0, 6); }
async function addBoard() {
  if (!HAS_BT) {
    boardNote(!window.isSecureContext ? `Bluetooth needs a secure page. Open https://tsmorz.github.io${location.pathname} (or localhost), not ${location.host}.`
      : 'This browser has no Web Bluetooth. Use Chrome or Edge on a computer.');
    return;
  }
  boardNote('Choose your board in the browser’s Bluetooth list. No list? Open this page in Chrome or Edge itself, not an app’s built-in browser.', false);
  let device;
  try { device = await navigator.bluetooth.requestDevice({ filters: [{ namePrefix: C.IMU.namePrefix }], optionalServices: [C.IMU.service, C.ACT.service, ControllerVoice.AUDIO.service] }); } catch (e) {
    boardNote(await btFailure(e));
    return;
  }
  boardNote('');
  connectDevice(device);
}
// why the chooser didn't give a board: nothing to say if the visitor closed it, else what to do
async function btFailure(e) {
  const msg = ((e && e.message) || String(e)).replace(/\.$/, ''), name = e && e.name;
  if (name === 'NotFoundError' && /cancel/i.test(msg)) return '';
  let avail = null;
  try { avail = await navigator.bluetooth.getAvailability(); } catch (_) { /* unknown */ }
  if (name === 'SecurityError') return window.top !== window ? 'Bluetooth isn’t allowed inside this frame. Open the tag tracker in its own Chrome or Edge tab.' : `Bluetooth isn’t allowed here (${msg}).`;
  if (/globally disabled|not supported|disabled/i.test(msg) || name === 'NotSupportedError') return `Bluetooth is turned off in this browser (${msg}). In Brave, turn on brave://flags/#brave-web-bluetooth-api; on Linux, chrome://flags/#enable-experimental-web-platform-features.`;
  if (avail === false || /adapter/i.test(msg)) return 'No Bluetooth adapter is available. Is Bluetooth on? On a Mac, also allow your browser under System Settings › Privacy & Security › Bluetooth.';
  return `Couldn’t open the Bluetooth chooser: ${msg}`;
}
async function connectDevice(device) {
  const id = idOf(device);
  let b = S.boards.find((x) => x.id === id);
  if (b && ['connecting', 'pairing', 'live'].includes(b.state) && !b.serialLink) return;
  if (!b) b = newBoard(id, device.name || 'nrf-controller-' + id);
  if(b.serialLink){b.serialLink.detach(b.id);b.hapticCharacteristic=null;b.hapticBusy=false;b.hapticRateHz=10;b.transport=null;b.serialRtt=null;b.actuatorDelayMs=null;b.act=null;b.actT=0;b.clock=new C.BoardClock();b.buf=[];b.lastSeq=null;}
  b.device = device; b.state = 'connecting'; b.err = ''; b.closing = false;
  renderBoards();
  if (!b.listening) { device.addEventListener('gattserverdisconnected', () => boardGone(b)); b.listening = true; }
  try {
    const server = await device.gatt.connect(), svc = await server.getPrimaryService(C.IMU.service);
    b.state = 'pairing'; paintBoards();
    const info = C.decodeBoardInfo(await (await svc.getCharacteristic(C.IMU.info)).readValue());
    if (!info) throw new Error('its firmware sends another data format; update it with the data logger');
    b.info = info; b.W = null; b.lastSeq = null;
    const ch = await svc.getCharacteristic(C.IMU.data);
    ch.addEventListener('characteristicvaluechanged', (e) => onBatch(b, e.target.value, (e.timeStamp || performance.now()) / 1000));
    await ch.startNotifications();
    b.state = 'live'; b.retries = 0;
    // the gripper servo on the operator's hand, if the board lets us read it (a board allowed here before the page asked
    // for its telemetry service has to be connected again from Connect for that)
    try {
      const ach = await (await server.getPrimaryService(C.ACT.service)).getCharacteristic(C.ACT.status);
      ach.addEventListener('characteristicvaluechanged', (e) => { const st = C.decodeActuatorStatus(e.target.value); if (st) { b.act = st; b.actT = performance.now(); onBoardVoiceKeys(b,st.keys); } });
      await ach.startNotifications(); b.actOk = true; b.hapticCharacteristic = ach; b.hapticError = null;
    } catch (e) { b.actOk = false; }
    await connectBoardVoice(b,server);
  } catch (e) {
    b.state = 'error'; b.err = e && e.message ? e.message : String(e);
    if (device.gatt.connected) device.gatt.disconnect();
  }
  renderBoards();
}
function boardGone(b) {
  voiceBoardGone(b);
  if (b.closing || b.state === 'error') { if (b.closing) b.state = 'saved'; paintBoards(); return; }
  b.state = 'lost'; b.retries = (b.retries || 0) + 1; paintBoards();
  if (b.retries <= 5) setTimeout(() => { if (b.state === 'lost' && S.boards.includes(b)) connectDevice(b.device); }, 1500 * b.retries);
  else { b.state = 'error'; b.err = 'Lost it. Is it on and in range? Press Connect to try again.'; renderBoards(); }
}
// boards this site may already use (chosen before, here or in the data logger: Chrome's permission is per site)
async function rememberBoards() {
  if (!HAS_BT || !navigator.bluetooth.getDevices) return;
  try {
    for (const d of await navigator.bluetooth.getDevices()) {
      if (!(d.name || '').startsWith(C.IMU.namePrefix) || S.boards.some((b) => b.id === idOf(d))) continue;
      Object.assign(newBoard(idOf(d), d.name), { device: d, state: 'saved' });
    }
    renderBoards();
  } catch (e) { /* not allowed here */ }
}
// a line under the Motion sensors heading for what Connect is doing or why it failed (bad: shown as a warning)
function boardNote(text, bad = true) { const m = $('boardMsg'); m.textContent = text; m.hidden = !text; m.classList.toggle('bad', bad); }

// the panel
function renderBoards() {
  const list = $('boardList');
  list.textContent = '';
  const keys = trackKeys();
  for (const b of S.boards) {
    const row = document.createElement('div');
    row.className = 'brow board';
    const canConnect = !b.sim && b.device && ['saved', 'error', 'lost'].includes(b.state);
    row.innerHTML = `<span class="sw" style="background:${b.track !== null ? cssColorOf(b.track) : 'var(--unknown)'}"></span>
      <strong style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(b.name)}">${escapeHtml(b.name)}</strong>
      <label class="sr" for="bt-${b.id}">What board ${escapeHtml(b.id)} is fixed to</label>
      <select id="bt-${b.id}" class="select sm"><option value="">Fixed to…</option>${keys.map((k) => `<option value="${k}"${k === b.track ? ' selected' : ''}>${escapeHtml(nameOf(k))}</option>`).join('')}</select>
      <label class="field">${escapeHtml(TASK_DATA.haptics.routing)} <select class="select sm" data-haptic-side>${['auto','1','-1','off'].map((v,i)=>`<option value="${v}"${b.hapticSide===v?' selected':''}>${escapeHtml(TASK_DATA.haptics.sides[i])}</option>`).join('')}</select></label>
      <span class="field" title="Use it in Filtered poses once it is lined up"><span id="bu-${b.id}">Use</span><button class="switch" role="switch" aria-checked="${b.use}" aria-labelledby="bu-${b.id}" data-a="use"></button></span>
      <span style="white-space:nowrap">${canConnect ? '<button class="btn sm" data-a="connect">Connect</button>' : ''}<button class="btn sm" data-a="relearn" title="Learn again how it sits on what it's fixed to">Relearn</button>${b.sim ? '' : `<button class="btn sm sq danger" data-a="rm" aria-label="Disconnect ${escapeHtml(b.name)}" title="Disconnect"><svg class="i"><use href="#i-x"/></svg></button>`}</span>
      <div class="meta"><span class="seen" id="bs-${b.id}"><span class="dot"></span><span></span></span><span id="bl-${b.id}"></span></div>
      ${b.sim ? '' : `<div class="meta"><span id="bg-${b.id}"></span><span style="white-space:nowrap"><button class="btn sm outline" data-a="gopen" title="Open the gripper on your hand fully, then press this">Set open</button><button class="btn sm outline" data-a="gclosed" title="Close the gripper on your hand fully, then press this">Set closed</button></span></div>`}`;
    row.querySelector('select').onchange = (e) => {
      b.track = e.target.value === '' ? null : parseKey(e.target.value);
      b.M = null; b.W = null; b.pairs = []; b.rms = null; b.fit = null; boardStore.save(b); renderBoards();
    };
    row.querySelector('[data-haptic-side]').onchange=e=>{b.hapticSide=e.target.value;boardStore.save(b);};
    row.querySelector('[data-a=use]').onclick = () => { b.use = !b.use; boardStore.save(b); renderBoards(); };
    row.querySelector('[data-a=relearn]').onclick = () => { b.M = null; b.W = null; b.pairs = []; b.rms = null; b.fit = null; b.learn = ''; boardStore.save(b); renderBoards(); };
    const rm = row.querySelector('[data-a=rm]');
    if (rm) rm.onclick = () => { voiceBoardGone(b); b.closing = true; if (b.serialLink) b.serialLink.close().catch(()=>{});if (b.device && b.device.gatt.connected) b.device.gatt.disconnect(); S.boards = S.boards.filter((x) => x !== b); renderBoards(); };
    for (const [a, k] of [['gopen', 'open'], ['gclosed', 'closed']]) {
      const g = row.querySelector(`[data-a=${a}]`);
      if (g) g.onclick = () => { const p = C.gripPermille(b.act); if (p === null) return; b.grip = Object.assign({}, b.grip, { [k]: p }); boardStore.save(b); paintBoards(); };
    }
    const cn = row.querySelector('[data-a=connect]');
    if (cn) cn.onclick = () => { b.retries = 0; connectDevice(b.device); };
    list.appendChild(row);
  }
  list.dataset.keys = keys.join('|');
  if (S.boards.length) $('boardsHint').hidden = true;
  paintBoards();paintVoiceSources();
}
function paintBoards() {
  if ($('boardList').dataset.keys !== trackKeys().join('|')) { renderBoards(); return; }
  const now = performance.now(), deg = (r) => ((r * 180) / Math.PI).toFixed(1);
  for (const b of S.boards) {
    if (now - b.rateT > 900) { b.rate = ((b.n - b.nPrev) * 1000) / (now - b.rateT); b.nPrev = b.n; b.rateT = now; }
    const st = $('bs-' + b.id), ln = $('bl-' + b.id);
    if (!st) continue;
    const live = b.state === 'live';
    st.classList.toggle('on', live && b.rate > 50);
    st.lastElementChild.textContent = live ? `${b.rate.toFixed(0)} Hz${b.lost ? `, ${b.lost} lost` : ''}` : { connecting: 'Connecting…', pairing: 'Pairing: if asked, enter the code the board prints on its USB console', lost: b.serialLink ? (b.serialLink.closed?TASK_DATA.link.closed:TASK_DATA.link.missing) : 'Disconnected, trying again…', saved: 'Not connected', error: b.err }[b.state] || '';
    ln.textContent = !live ? '' : b.track === null ? 'Choose what it’s fixed to.'
      : !b.M ? `Learning how it sits: turn it slowly about different axes while a camera sees it (${b.pairs.length} poses${b.learn === 'turn' ? ', needs more turning' : b.learn === 'fit' ? ', poses disagree: is it fixed firmly?' : ''})`
      : !b.W ? 'Finding its heading…'
      : `Lined up${b.fit != null ? `, within ${deg(b.fit)}°` : ''}${!b.use ? ', not used' : S.settings.pose !== 'filtered' ? '; used by Filtered poses' : ''}`;
    if(live&&b.transport)ln.textContent=(b.transport==='esb'?TASK_DATA.link.esb:TASK_DATA.link.serial)+(Number.isFinite(b.serialRtt)?`, ${b.serialRtt.toFixed(1)} ms ${TASK_DATA.link.rtt}`:'')+(Number.isFinite(b.actuatorDelayMs)?`, ${b.actuatorDelayMs.toFixed(1)} ms ${TASK_DATA.link.drive_delay}`:'')+(b.linkDropped||b.radioDropped?`, ${b.linkDropped||0} / ${b.radioDropped||0} ${TASK_DATA.link.dropped}`:'')+'; '+ln.textContent;
    const gl = $('bg-' + b.id);
    if (gl) {
      const fresh = b.act && now - b.actT < 500, p = fresh ? C.gripPermille(b.act) : null, g = fresh ? C.gripOpening(b.act, b.grip) : null;
      gl.textContent = !live ? '' : b.actOk === false ? 'Gripper: not readable. Remove the board and Connect it again to allow it.'
        : p === null ? 'Gripper: no servo reading.'
        : g !== null ? `Gripper ${Math.round(g * 100)}% open${b.track === null ? '; choose what it’s fixed to' : ''}`
        : `Gripper at ${(p / 10).toFixed(1)}% of its supply: open it fully and press Set open, close it and press Set closed.`;
      gl.parentElement.querySelectorAll('button').forEach((x) => { x.disabled = p === null; });
    }
  }
}
$('addBoard').onclick = addBoard;
setInterval(paintBoards, 500);

// The demo's motion sensors: one simulated board on each hand, fixed at a slant, sending the bytes a real board sends
// (encodeImuBatch): 208 Hz in batches of up to 8, its own clock (30 ppm fast, starting near the 32-bit wrap), a gyro
// bias VQF has nearly learned, noise, a heading that wanders, and 4 to 20 ms of Bluetooth delay. It feels the scene as
// the demo's cameras see it: drawn about DEMO_LAG before each frame reaches the page.
const DEMO_LAG = 0.02;
const SIM_BOARDS = [
  { id: 'SIM1', name: 'Simulated board, left hand', hand: 0, track: 'b:demo-left', M: C.mul3(C.rodrigues([0, 0, Math.PI / 2]), C.rodrigues([0.12, -0.08, 0.05])) },
  { id: 'SIM2', name: 'Simulated board, right hand', hand: 1, track: 'b:demo-right', M: C.mul3(C.rodrigues([Math.PI, 0, 0]), C.rodrigues([-0.05, 0.1, 0.2])) },
];
function startSimBoards(t0) {
  const timers = [];
  let g = 17;
  const gauss = () => { let x = 0; for (let i = 0; i < 12; i++) { g = (g * 1103515245 + 12345) % 2147483648; x += g / 2147483648; } return x - 6; };
  for (const sb of SIM_BOARDS) {
    let b = S.boards.find((x) => x.id === sb.id);
    if (!b) b = newBoard(sb.id, sb.name, { sim: true });
    if (b.track === null) { b.track = sb.track; boardStore.save(b); }
    b.info = C.decodeBoardInfo(C.encodeBoardInfo(0x5100 + sb.hand, 208, 0.07, 0.000244));
    b.state = 'live'; b.W = null;
    const W0 = C.mul3(C.rodrigues([Math.PI / 2, 0, 0]), C.rodrigues([0, 0, 0.7 + sb.hand])); // VQF's z up is camera 1's −y
    const bias = [0.6, -0.4, 0.9], est = [0.55, -0.43, 0.86], front = DEMO_HANDS[sb.hand].ids[0];
    const objR = (tp) => demoTags(tp - t0 / 1000 - DEMO_LAG).find((x) => x.id === front).R;
    let next = performance.now() / 1000, seq = 4294967200, heading = 0;
    timers.push(setInterval(() => {
      const now = performance.now() / 1000, out = [];
      while (next <= now && out.length < 8) {
        const tp = next;
        next += 1 / 208; heading += 0.0004 * gauss();
        const W = C.mul3(W0, C.rodrigues([0, 0, heading])), Q = C.mul3(C.tr3(W), C.mul3(objR(tp), C.tr3(sb.M))), Q1 = C.mul3(C.tr3(W), C.mul3(objR(tp + 0.001), C.tr3(sb.M)));
        const wb = C.so3Log(C.mul3(C.tr3(Q), Q1)).map((x) => (x / 0.001) * (180 / Math.PI));
        out.push({
          tUs: Math.round(tp * 1e6 * (1 + 30e-6) + 4294000000) % 4294967296,
          gyro: wb.map((x, i) => (x + bias[i] + 0.1 * gauss()) / 0.07), accel: C.mulv(C.tr3(Q), [0, 0, 1]).map((x) => x / 0.000244),
          q: C.quatOf(C.mul3(Q, C.rodrigues([0.004 * gauss(), 0.004 * gauss(), 0]))), rest: false,
        });
      }
      if (!out.length) return;
      const view = C.encodeImuBatch(seq, est, out), wait = (next - 1 / 208 + 0.004 + 0.016 * Math.random() - now) * 1000;
      seq = (seq + out.length) >>> 0;
      setTimeout(() => { if (S.boards.includes(b)) onBatch(b, view, performance.now() / 1000); }, Math.max(0, wait));
    }, 38));
  }
  renderBoards();
  return () => { timers.forEach(clearInterval); S.boards = S.boards.filter((b) => !b.sim); renderBoards(); };
}
