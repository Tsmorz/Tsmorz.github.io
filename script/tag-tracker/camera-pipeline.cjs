// Camera streams and asynchronous image preparation must never replay superseded frames.
module.exports = async function ({ check }) {
  const fs = require('fs'), path = require('path'), vm = require('vm');
  const root = path.resolve(__dirname, '../..');
  const source = fs.readFileSync(path.join(root, 'tag-tracker/app-cameras.js'), 'utf8');
  const take = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
  const main = take('function idleWorker(', 'const pending =') + take('function onWorker(', 'function requestImage(') + take('function loopFrames(', 'function tickStats(');
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
  const until = async (ready) => { for (let i = 0; i < 20 && !ready(); i++) await flush(); if (!ready()) throw new Error('mock camera lifecycle did not reach the expected await'); };
  class Bitmap { constructor() { this.closed = 0; } close() { this.closed++; } }
  function fixture(videoFrame) {
    let now = 1000;
    const waiting = [], posted = [], tags = [], boards = [], plans = [];
    const slots = [0, 1].map(() => ({ first: true, ready: true, busy: false, w: { postMessage: m => posted.push(m) } }));
    const video = { videoWidth: 1280, videoHeight: 720, requestVideoFrameCallback: fn => { video.next = fn; } };
    const c = { key: 'same-device', session: 2, video, cam: { w: 1280, h: 720 }, inflight: 0, seq: 0, sentSeq: 0, doneSeq: 0, sinceFull: 0, expect: new Map(), stats: { frames: 0 } };
    const S = { ready: true, cams: [c], pool: slots, bodies: [], mode: 'track', settings: { tagSize: .08, pose: 'filtered' } };
    const context = { S, console, Map, ImageBitmap: Bitmap, HAS_VF: !!videoFrame, VideoFrame: videoFrame,
      HTMLVideoElement: { prototype: { requestVideoFrameCallback() {} } }, performance: { now: () => now },
      camOf: key => S.cams.find(x => x.key === key), onTags: (cam, m) => tags.push({ cam, m }), onBoard: (cam, m) => boards.push({ cam, m }),
      sizesMap: () => ({}), searchPlan: (cam, time) => { plans.push(time); return { rois: [{ x: 10, y: 20, w: 64, h: 64 }], expect: [42] }; },
      createImageBitmap: () => new Promise((resolve, reject) => waiting.push({ resolve, reject })),
    };
    vm.createContext(context); vm.runInContext(main, context);
    const frame = (stamp = now) => { now = stamp; video.next(now, { captureTime: now }); };
    context.loopFrames(c);
    return { context, c, S, video, slots, waiting, posted, tags, boards, plans, frame };
  }

  {
    const f = fixture(); f.c.inflight = 1; f.c.expect.set(1, [42]);
    for (const m of [{ type: 'tags' }, { type: 'board' }, { type: 'error', of: 'frame' }]) {
      f.slots[0].busy = true;
      f.context.onWorker({ ...m, src: f.c.key, session: 1, seq: 98 }, f.slots[0]);
      check(!f.slots[0].busy && f.c.inflight === 1 && f.c.doneSeq === 0 && f.c.expect.has(1) && !f.tags.length && !f.boards.length,
        'an old stream ' + m.type + ' frees its worker without changing the replacement camera');
    }
    f.context.onWorker({ type: 'tags', src: f.c.key, session: 2, seq: 1 }, f.slots[0]);
    check(f.c.inflight === 0 && f.c.doneSeq === 1 && f.tags.length === 1, 'the replacement camera accepts its first fresh result immediately');
  }
  {
    const f = fixture(); f.frame(1000); f.frame(1033);
    const old = new Bitmap(), latest = new Bitmap();
    f.waiting[1].resolve(latest); await flush();
    f.S.mode = 'calib'; f.S.settings.tagSize = .2;
    f.waiting[0].resolve(old); await flush();
    check(f.posted.length === 1 && f.posted[0].seq === 2 && f.posted[0].time === 1.033 && f.posted[0].session === 2 && f.posted[0].mode === 'track' && f.posted[0].defaultSize === .08,
      'reversed bitmap completion keeps capture order, capture time and original detection settings');
    check(old.closed === 1 && latest.closed === 0 && f.c.inflight === 1 && f.slots.filter(x => x.busy).length === 1 && f.c.expect.size === 1 && f.c.expect.has(2) && f.plans.join(',') === '1,1.033',
      'a superseded prepared bitmap closes and releases only its own reservation');
  }
  {
    const f = fixture(); f.frame(); f.S.mode = 'calib'; f.S.settings.tagSize = .2;
    f.waiting[0].resolve(new Bitmap()); await flush();
    check(f.posted[0].mode === 'track' && f.posted[0].defaultSize === .08 && f.posted[0].time === 1,
      'bitmap preparation cannot relabel a captured frame after page settings change');
  }
  {
    const f = fixture(); f.slots[0].w.postMessage = () => { throw new Error('transfer failed'); };
    f.frame(); const pic = new Bitmap(); f.waiting[0].resolve(pic); await flush();
    check(pic.closed === 1 && f.c.inflight === 0 && !f.slots[0].busy && !f.c.expect.size && f.c.sentSeq === 0,
      'a synchronous worker transfer failure closes the image and frees its reservation');
    f.context.createImageBitmap = () => { throw new Error('capture failed'); }; f.frame(1033);
    check(f.c.inflight === 0 && !f.slots[0].busy, 'a synchronous image preparation failure cannot strand a worker');
  }
  {
    const frames = [];
    class Frame extends Bitmap { constructor() { super(); frames.push(this); } }
    const f = fixture(Frame); f.slots[0].w.postMessage = () => { throw new Error('transfer failed'); }; f.frame();
    check(frames.length === 1 && frames[0].closed === 1 && f.c.inflight === 0 && !f.slots[0].busy && !f.c.expect.size,
      'the native VideoFrame path also releases a failed synchronous transfer');
    const g = fixture(); g.frame(); g.c.gone = true; const pic = new Bitmap(); g.waiting[0].resolve(pic); await flush();
    check(pic.closed === 1 && g.c.inflight === 0 && !g.slots[0].busy && !g.posted.length, 'a stopped stream discards pending prepared images');
  }

  function lifecycle({ holdPlay = false, holdConfigure = false } = {}) {
    const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
    const requests = [], plays = [], configurations = [], tiles = [], frames = [], errors = [], demos = [], elements = new Map();
    const element = id => {
      if (!elements.has(id)) elements.set(id, { value: '', children: [], classList: { toggle() {}, remove() {} }, appendChild(x) { this.children.push(x); } });
      return elements.get(id);
    };
    element('camSel').value = 'same-device'; element('camSel').options = [{ value: 'same-device' }, { value: 'demo' }];
    const S = { ready: true, cams: [], demo: null, running: false, firstKey: null, calibCam: 0, res: '1280x720', captureFps: 60, tare: new Map() };
    const stream = () => { const track = { stopped: 0, getSettings: () => ({ deviceId: 'same-device' }), stop() { this.stopped++; } }; return { track, getTracks: () => [track], getVideoTracks: () => [track] }; };
    const context = { S, console, Map, Set, performance: { now: () => 1000 }, DEMO: { cams: [{}] },
      navigator: { mediaDevices: { getUserMedia: () => { const q = deferred(); requests.push(q); return q.promise; } } },
      cameraCaptureCore: { constraints: () => ({}) }, store: { set() {} }, $: element,
      document: { documentElement: { classList: { remove() {} } } },
      camError: e => errors.push(e), status() {}, showEmpty() {}, listCameras: async () => {}, deviceLabel: () => 'Built-in camera',
      refreshCameraSettings() { element('cameraResolution').value = S.res; },
      makeTile: () => {
        const video = { srcObject: null, addEventListener() {}, play: () => { const q = deferred(); plays.push(q); if (!holdPlay) q.resolve(); return q.promise; } };
        const tile = { video, removed: false, querySelector: sel => sel === 'video' ? video : {}, remove() { this.removed = true; } }; tiles.push(tile); return tile;
      },
      configureCameraCapture: () => { const q = deferred(); configurations.push(q); if (!holdConfigure) q.resolve(); return q.promise; },
      loopFrames: c => frames.push(c),
      startDemo: () => { const q = deferred(), demo = { streams: [stream()], stopped: false, stop() { this.stopped = true; } }; demos.push({ demo, complete() { S.demo = demo; q.resolve(); } }); return q.promise; },
    };
    for (const fn of ['resetTracks', 'paintTare', 'robotReset', 'placeCams', 'updateCam', 'paintAddCam', 'setupFocus', 'renderCalibCams', 'renderCalib', 'renderRig', 'layoutTiles']) context[fn] = () => {};
    const code = take('let devices =', 'async function listCameras(') + take('async function start()', 'function camError(') + take('async function addCamera(', 'function removeCamera(') + take('function onCamsChanged(', '// Each camera\'s pose') + take('function stop(quiet)', '// Focus:') + take("$('resSel').value", "$('emptyStart').onclick");
    vm.createContext(context); vm.runInContext(code, context);
    return { context, S, requests, plays, configurations, tiles, frames, errors, demos, stream, element, pending: () => vm.runInContext('pendingCameras.size', context) };
  }
  {
    const f = lifecycle(), old = f.context.start(), latest = f.context.start(), a = f.stream(), b = f.stream();
    f.requests[1].resolve(b); await latest; f.requests[0].resolve(a); await old;
    check(a.track.stopped === 1 && b.track.stopped === 0 && f.S.cams.length === 1 && f.S.cams[0].stream === b && f.frames.length === 1 && !f.errors.length,
      'a same-device restart stops a late old acquisition without replacing or stopping the newest stream');
    check(!f.pending() && f.tiles.length === 1 && !f.tiles[0].removed, 'a superseded acquisition never leaves an unseen camera tile or pending entry');
  }
  {
    const f = lifecycle(), starting = f.context.start(), pic = f.stream();
    check(/Stop/.test(f.element('startBtn').innerHTML), 'Stop remains available while camera permission or acquisition is pending');
    f.element('startBtn').onclick(); f.requests[0].resolve(pic); await starting;
    check(pic.track.stopped === 1 && !f.S.cams.length && !f.frames.length && !f.tiles.length && !f.pending() && /Start/.test(f.element('startBtn').innerHTML),
      'Stop during camera acquisition closes the late stream before creating a video or starting detection');
    f.element('resSel').value = '640x480'; f.element('resSel').onchange();
    check(f.S.res === '640x480' && f.element('cameraResolution').value === '640x480' && f.requests.length === 1,
      'resolution changes while stopped update Settings without acquiring a camera');
  }
  {
    const f = lifecycle({ holdPlay: true }), starting = f.context.start(), pic = f.stream();
    f.requests[0].resolve(pic); await flush(); f.context.stop();
    check(pic.track.stopped === 1 && f.tiles[0].removed && f.tiles[0].video.srcObject === null && !f.pending(),
      'Stop during video.play immediately closes the active stream and removes its pending tile');
    f.plays[0].resolve(); await starting;
    check(!f.S.cams.length && !f.frames.length && !f.errors.length, 'a late video.play completion cannot resurrect a stopped camera');
  }
  {
    const f = lifecycle({ holdConfigure: true }), starting = f.context.start(), pic = f.stream();
    f.requests[0].resolve(pic); await until(() => f.configurations.length); f.context.stop(); f.configurations[0].resolve(); await starting;
    check(pic.track.stopped === 1 && !f.S.cams.length && !f.frames.length && !f.pending() && f.tiles[0].removed,
      'Stop during capability configuration prevents a stopped camera from returning after constraints finish');
  }
  {
    const f = lifecycle(), old = f.context.start(), latest = f.context.start(), pic = f.stream();
    f.requests[1].resolve(pic); await latest; f.requests[0].reject(new Error('old permission failed')); await old;
    check(pic.track.stopped === 0 && f.S.running && f.S.cams.length === 1 && !f.errors.length,
      'an obsolete start failure never stops or replaces the status of a newer live camera');
  }
  {
    const f = lifecycle(); f.element('camSel').value = 'demo';
    const old = f.context.start(), latest = f.context.start(); f.demos[0].complete(); await until(() => f.demos.length === 2);
    f.demos[1].complete(); await Promise.all([old, latest]);
    check(f.demos[0].demo.stopped && f.demos[0].demo.streams[0].track.stopped === 1 && !f.demos[1].demo.stopped && f.S.demo === f.demos[1].demo && f.S.cams.length === 1 && f.frames.length === 1,
      'overlapping demo starts dispose the cancelled initialization before starting the newest demo');
  }

  // Run the real worker message wrapper with a tiny vision stub; this checks replies as well as the caller.
  {
    const replies = [], matrices = [];
    class Mat {
      constructor(rows, cols) { this.rows = rows; this.cols = cols; this.data = new Uint8Array(rows * cols); matrices.push(this); }
      delete() { this.deleted = true; }
    }
    const cv = { Mat, CV_8UC1: 0, getBuildInformation: () => 'Version control: test' };
    const vision = { setFamily() {}, familySize: () => 587, track: () => ({ tags: [], bodies: [] }), detectBoard: () => ({ ids: [], pts: [], markers: [] }) };
    const factory = () => vision; factory.ready = async () => cv;
    const context = { console, performance: { now: () => 1000 } };
    context.self = context; context.location = { search: '' }; context.postMessage = m => replies.push(m);
    context.importScripts = () => { context.cv = cv; context.TagVisionFactory = factory; };
    vm.createContext(context); vm.runInContext(fs.readFileSync(path.join(root, 'tag-tracker/worker.js'), 'utf8'), context);
    await context.onmessage({ data: { type: 'init', family: 'APRILTAG_36h11', quality: 'fast' } });
    const frame = (fail = false) => ({ format: 'NV12', visibleRect: { x: 2, y: 4, width: 4, height: 2 }, allocationSize: () => 16,
      copyTo: async buf => { if (fail) throw new Error('readback failed'); buf.set([0, 0, 16, 32, 48, 64, 0, 0, 80, 96, 112, 128]); return [{ offset: 2, stride: 6 }]; }, close() { this.closed = true; } });
    for (const mode of ['track', 'calib']) {
      const pic = frame();
      await context.onmessage({ data: { type: 'frame', src: 'same-device', session: 7, seq: 3, time: 1, mode, frame: pic } });
      const m = replies.at(-1), mat = matrices.at(-1);
      check(m.type === (mode === 'track' ? 'tags' : 'board') && m.session === 7 && m.seq === 3 && m.src === 'same-device' && pic.closed && mat.deleted && Array.from(mat.data).join(',') === '16,32,48,64,80,96,112,128',
        'worker ' + mode + ' replies preserve stream identity and copy padded native luma safely');
    }
    const pic = frame(true);
    await context.onmessage({ data: { type: 'frame', src: 'same-device', session: 8, seq: 4, mode: 'track', frame: pic } });
    check(replies.at(-1).type === 'error' && replies.at(-1).session === 8 && replies.at(-1).seq === 4 && pic.closed,
      'worker readback errors preserve stream identity and close the frame');
  }
};
