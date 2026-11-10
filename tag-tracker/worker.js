// The OpenCV side of /tag-tracker/, run in a Web Worker so detection never stalls the page.
// TagVision (no DOM, no worker globals) does the work and is what script/test-tag-tracker drives in Node;
// the bottom of the file wraps it in worker messages.
//
// Tracking: OpenCV's ArUco detector with an AprilTag dictionary and AprilTag corner refinement, then one
// solvePnP (IPPE_SQUARE) per tag with that tag's printed size.
// Placing several cameras: the same board's pose in each camera (boardPose), solved together in TagCore.calibrateRig.
// Calibration: a ChArUco board (5×5 ArUco markers, so its markers never clash with AprilTag ids) seen from
// many angles, then calibrateCameraExtended with k3 held at 0, which webcam lenses don't need.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.TagVisionFactory = factory;
})(typeof self !== 'undefined' ? self : this, (function () {
// OpenCV.js may arrive as a Promise, or as an Emscripten module that is itself "thenable" and resolves
// to itself, which would make a plain `await` loop forever. Wrap the result before resolving.
async function ready(cv) {
  if (cv instanceof Promise) cv = await new Promise((res, rej) => cv.then((m) => res({ m }), rej)).then((w) => w.m);
  if (!(cv && cv.Mat)) await new Promise((res) => {
    const prev = cv.onRuntimeInitialized;
    cv.onRuntimeInitialized = () => { if (prev) prev(); res(); };
    const poll = setInterval(() => { if (cv.Mat) { clearInterval(poll); res(); } }, 50);
  });
  // An async function returning a thenable would chase it forever, so drop the module's `then`.
  if (typeof cv.then === 'function') { try { delete cv.then; } catch (e) { /* not configurable */ } }
  if (typeof cv.then === 'function') cv.then = undefined;
  return cv;
}
function TagVision(cv, Core) {
  'use strict';

  const FAMILIES = { APRILTAG_36h11: 'DICT_APRILTAG_36h11', APRILTAG_25h9: 'DICT_APRILTAG_25h9', APRILTAG_16h5: 'DICT_APRILTAG_16h5', APRILTAG_36h10: 'DICT_APRILTAG_36h10' };
  // The calibration board: 9 × 6 squares, markers 72% of a square. The printed square size is entered by the
  // visitor; only the ratio is fixed here.
  const BOARD = { cols: 9, rows: 6, markerRatio: 0.72, dict: 'DICT_5X5_100' };

  let gray = null, grayW = 0, grayH = 0;
  let tagDet = null, family = null;
  let boardDet = null, board = null, boardCorners = null;
  let refine = null;

  function grayMat(w, h) {
    if (!gray || grayW !== w || grayH !== h) {
      if (gray) gray.delete();
      gray = new cv.Mat(h, w, cv.CV_8UC1);
      grayW = w; grayH = h;
    }
    return gray;
  }
  // RGBA bytes to luma, into the shared Mat.
  function setRGBA(rgba, w, h) {
    const m = grayMat(w, h), d = m.data, n = w * h;
    for (let i = 0, j = 0; i < n; i++, j += 4) d[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
    return m;
  }
  function setGray(g, w, h) { const m = grayMat(w, h); m.data.set(g); return m; }

  function refineParams() { if (!refine) refine = new cv.aruco_RefineParameters(10, 3, true); return refine; }

  // Detector settings. Both use AprilTag's own quad finder and edge refinement. "precise" looks for quads at
  // full resolution: about 0.1 px corner error on rendered tags, ~13 ms at 1280×720 in Node. "fast" halves
  // the image first: about 0.3 px, ~3 ms. The light blur and the 15-level contrast floor keep sensor noise
  // from turning into thousands of tiny candidate quads, which otherwise costs hundreds of ms a frame.
  const QUALITY = {
    precise: { decimate: 1, sigma: 0.8, minDiff: 15 },
    fast: { decimate: 2, sigma: 0.8, minDiff: 10 },
  };
  let quality = null;
  function setFamily(name, q) {
    q = QUALITY[q] ? q : 'precise';
    if (!FAMILIES[name]) throw new Error('unknown tag family ' + name);
    if (tagDet && family === name && quality === q) return;
    if (tagDet) tagDet.delete();
    const dict = cv.getPredefinedDictionary(cv[FAMILIES[name]]);
    const p = new cv.aruco_DetectorParameters(), Q = QUALITY[q];
    p.cornerRefinementMethod = cv.CORNER_REFINE_APRILTAG;
    p.aprilTagQuadDecimate = Q.decimate;
    p.aprilTagQuadSigma = Q.sigma;
    p.aprilTagMinWhiteBlackDiff = Q.minDiff;
    tagDet = new cv.aruco_ArucoDetector(dict, p, refineParams());
    p.delete(); dict.delete();
    family = name; quality = q;
  }

  function camMats(c) {
    const K = cv.matFromArray(3, 3, cv.CV_64F, [c.fx, 0, c.cx, 0, c.fy, c.cy, 0, 0, 1]);
    const d = c.dist || [0, 0, 0, 0, 0];
    const D = cv.matFromArray(1, 5, cv.CV_64F, [d[0] || 0, d[1] || 0, d[2] || 0, d[3] || 0, d[4] || 0]);
    return { K, D };
  }

  // Detect tags and estimate each one's pose. sizes maps id → printed side (m) of the black square;
  // ids not in it use defaultSize. Each tag comes back with OpenCV's pose (R, t, err) and, unless `raw`,
  // `cands`: that pose and its mirror image refined by Levenberg–Marquardt on SE(3), best fit first, each with
  // a covariance. Each rigid object in `bodies` gets the same, solved from all its visible tags at once.
  //
  // `img` is the whole picture, or a list of search windows [{img, x, y}] (each a grey Mat of part of the picture and
  // where it sits in it): then only those are searched, and their corners are given in the whole picture's pixels.
  // A tag that belongs to an object is refined only as part of it, unless `learn` (learning an object's shape needs each
  // tag's own pose).
  function track(img, cam, sizes, defaultSize, bodies, raw, learn) {
    let tags;
    if (Array.isArray(img)) {
      tags = [];
      for (const w of img) for (const t of detectTags(w.img, cam, sizes, defaultSize, w.x, w.y)) if (!tags.some((q) => q.id === t.id)) tags.push(t);
    } else tags = detectTags(img, cam, sizes, defaultSize);
    const out = { tags, bodies: [] };
    if (raw) return out;
    const member = new Set(learn ? [] : (bodies || []).flatMap((b) => b.members.map((m) => m.id)));
    for (const t of tags) if (t.R && !member.has(t.id)) t.cands = Core.solveTag(cam, t.corners, t.size, t, { sigma: 'auto' }).slice(0, 2);
    for (const b of bodies || []) {
      if (!b.members.some((m) => tags.some((t) => t.id === m.id))) continue;
      const cands = Core.solveBody(cam, b, tags.filter((t) => t.R), { sigma: 'auto' }).slice(0, 2);
      if (cands.length) out.bodies.push({ id: b.id, cands, seen: cands[0].seen });
    }
    return out;
  }
  // (x0, y0): where `img` sits in the camera's picture, when it is a search window.
  function detectTags(img, cam, sizes, defaultSize, x0, y0) {
    const corners = new cv.MatVector(), ids = new cv.Mat(), rej = new cv.MatVector();
    const out = [];
    try {
      tagDet.detectMarkers(img, corners, ids, rej);
      if (!ids.rows) return out;
      const { K, D } = camMats(cam);
      const rvec = new cv.Mat(), tvec = new cv.Mat();
      for (let i = 0; i < ids.rows; i++) {
        const id = ids.intAt(i, 0), c = corners.get(i), cd = c.data32F;
        // AprilTag reports corners with pixel (0, 0) spanning 0 to 1; OpenCV's camera model puts its centre at 0.
        for (let k = 0; k < 8; k++) cd[k] += (k % 2 ? y0 || 0 : x0 || 0) - 0.5;
        const px = Array.from(cd);
        const s = (sizes && sizes[id]) || defaultSize, h = s / 2;
        // IPPE_SQUARE wants this order: top-left, top-right, bottom-right, bottom-left, with y up the tag.
        const obj = cv.matFromArray(4, 1, cv.CV_32FC3, [-h, h, 0, h, h, 0, h, -h, 0, -h, -h, 0]);
        let ok = false;
        try { ok = cv.solvePnP(obj, c, K, D, rvec, tvec, false, cv.SOLVEPNP_IPPE_SQUARE); } catch (e) { ok = false; }
        const tag = { id, corners: px, size: s };
        if (ok) {
          const R = Core.rodrigues(Array.from(rvec.data64F)), t = Array.from(tvec.data64F);
          // reprojection error, in pixels
          let err = 0;
          const P = [[-h, h], [h, h], [h, -h], [-h, -h]];
          for (let k = 0; k < 4; k++) {
            const q = Core.project(cam, Core.add(Core.mulv(R, [P[k][0], P[k][1], 0]), t));
            err += q ? Math.hypot(q[0] - px[2 * k], q[1] - px[2 * k + 1]) : 1e3;
          }
          tag.R = R; tag.t = t; tag.err = err / 4;
        }
        out.push(tag);
        obj.delete(); c.delete();
      }
      rvec.delete(); tvec.delete(); K.delete(); D.delete();
      return out;
    } finally { corners.delete(); ids.delete(); rej.delete(); }
  }

  function makeBoard() {
    if (board) return;
    const dict = cv.getPredefinedDictionary(cv[BOARD.dict]);
    // square side 1 (unit), so object points come back in squares and scale by the printed size
    board = new cv.aruco_CharucoBoard(new cv.Size(BOARD.cols, BOARD.rows), 1, BOARD.markerRatio, dict, new cv.Mat());
    const p = new cv.aruco_DetectorParameters();
    p.cornerRefinementMethod = cv.CORNER_REFINE_SUBPIX;
    const cp = new cv.aruco_CharucoParameters();
    boardDet = new cv.aruco_CharucoDetector(board, cp, p, refineParams());
    const pts = board.getChessboardCorners();
    boardCorners = [];
    for (let i = 0; i < pts.size(); i++) { const q = pts.get(i); boardCorners.push([q.x, q.y]); }
    p.delete(); cp.delete(); dict.delete();
  }

  // Find the board's inner corners: their ids and pixel positions.
  function detectBoard(img) {
    makeBoard();
    const cc = new cv.Mat(), ci = new cv.Mat(), mc = new cv.MatVector(), mi = new cv.Mat();
    try {
      boardDet.detectBoard(img, cc, ci, mc, mi);
      const ids = [], pts = [];
      for (let i = 0; i < cc.rows; i++) { ids.push(ci.intAt(i, 0)); pts.push([cc.floatAt(i, 0), cc.floatAt(i, 1)]); }
      const markers = [];
      for (let i = 0; i < mc.size(); i++) { const m = mc.get(i); markers.push(Array.from(m.data32F)); m.delete(); }
      return { ids, pts, markers };
    } finally { cc.delete(); ci.delete(); mc.delete(); mi.delete(); }
  }

  // The board's pose in a camera with intrinsics `cam`, from its detected corners (squares of `square` m): OpenCV's
  // IPPE for a plane, then Levenberg–Marquardt on SE(3). For placing several cameras. null under 6 corners.
  function boardPose(ids, pts, cam, square) {
    makeBoard();
    if (ids.length < 6) return null;
    const obj = ids.map((i) => [boardCorners[i][0] * square, boardCorners[i][1] * square, 0]);
    const om = cv.matFromArray(obj.length, 1, cv.CV_32FC3, [].concat(...obj)), im = cv.matFromArray(pts.length, 1, cv.CV_32FC2, [].concat(...pts));
    const { K, D } = camMats(cam), rvec = new cv.Mat(), tvec = new cv.Mat();
    try {
      let ok = false;
      try { ok = cv.solvePnP(om, im, K, D, rvec, tvec, false, cv.SOLVEPNP_IPPE); } catch (e) { ok = false; }
      if (!ok) return null;
      const r = Core.refinePose(cam, obj, pts, { R: Core.rodrigues(Array.from(rvec.data64F)), t: Array.from(tvec.data64F) });
      return isFinite(r.cost) ? { R: r.R, t: r.t, rms: r.rms, obj } : null;
    } finally { [om, im, K, D, rvec, tvec].forEach((m) => m.delete()); }
  }

  // The board as a grey image, `px` pixels per square, for printing or showing on a screen.
  function boardImage(px) {
    makeBoard();
    const m = new cv.Mat();
    board.generateImage(new cv.Size(BOARD.cols * px, BOARD.rows * px), m, 0, 1);
    const out = { w: m.cols, h: m.rows, data: new Uint8Array(m.data) };
    m.delete();
    return out;
  }

  // One AprilTag as a grey image, `px` pixels for the black square (the white quiet zone is added by the page).
  function tagImage(name, id, px) {
    const dict = cv.getPredefinedDictionary(cv[FAMILIES[name]]), m = new cv.Mat();
    try {
      dict.generateImageMarker(id, px, m, 1);
      return { w: m.cols, h: m.rows, data: new Uint8Array(m.data) };
    } finally { m.delete(); dict.delete(); }
  }
  function familySize(name) {
    const dict = cv.getPredefinedDictionary(cv[FAMILIES[name]]), n = dict.bytesList.rows;
    dict.delete();
    return n;
  }

  // Calibrate from captured views ({ids, pts}) of a board whose squares are `square` metres.
  function calibrate(views, w, h, square) {
    makeBoard();
    const ov = new cv.MatVector(), iv = new cv.MatVector(), used = [];
    for (const v of views) {
      if (v.ids.length < 6) continue;
      const o = [], p = [];
      for (let i = 0; i < v.ids.length; i++) { const b = boardCorners[v.ids[i]]; o.push(b[0] * square, b[1] * square, 0); p.push(v.pts[i][0], v.pts[i][1]); }
      const om = cv.matFromArray(v.ids.length, 1, cv.CV_32FC3, o), im = cv.matFromArray(v.ids.length, 1, cv.CV_32FC2, p);
      ov.push_back(om); iv.push_back(im); om.delete(); im.delete();
      used.push(v);
    }
    if (used.length < 4) { ov.delete(); iv.delete(); throw new Error('need at least 4 views with 6 or more corners'); }
    const K = new cv.Mat(), D = new cv.Mat(), rv = new cv.MatVector(), tv = new cv.MatVector();
    const sdI = new cv.Mat(), sdE = new cv.Mat(), pe = new cv.Mat();
    try {
      const flags = cv.CALIB_FIX_K3;
      const crit = new cv.TermCriteria(cv.TermCriteria_COUNT + cv.TermCriteria_EPS, 100, 1e-10);
      const rms = cv.calibrateCameraExtended(ov, iv, new cv.Size(w, h), K, D, rv, tv, sdI, sdE, pe, flags, crit);
      const k = K.data64F, d = Array.from(D.data64F).slice(0, 5), s = Array.from(sdI.data64F);
      while (d.length < 5) d.push(0);
      return {
        w, h, fx: k[0], fy: k[4], cx: k[2], cy: k[5], dist: d, rms,
        sd: { fx: s[0], fy: s[1], cx: s[2], cy: s[3] },
        perView: Array.from(pe.data64F), views: used.length, square,
      };
    } finally { [ov, iv, K, D, rv, tv, sdI, sdE, pe].forEach((m) => m.delete()); }
  }

  return { FAMILIES, BOARD, QUALITY, setFamily, setRGBA, setGray, detectTags, track, detectBoard, boardPose, boardImage, tagImage, familySize, calibrate };
}
TagVision.ready = ready;
return TagVision;
})());

// ---- worker wrapper ----
if (typeof importScripts === 'function' && typeof module === 'undefined') (function () {
  'use strict';
  // Pinned OpenCV.js builds (4.12, with the ArUco/AprilTag detector and calib3d), tried in order.
  const CV_URLS = [
    'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.12.0-release.1/dist/opencv.js',
    'https://unpkg.com/@techstark/opencv-js@4.12.0-release.1/dist/opencv.js',
  ];
  let V = null, canvas = null, ctx = null;
  const post = (m, t) => self.postMessage(m, t || []);

  async function load() {
    importScripts('tracker-core.js');
    let lastErr = null;
    for (const u of CV_URLS) {
      try { importScripts(u); lastErr = null; break; } catch (e) { lastErr = e; }
    }
    if (lastErr) throw new Error('could not load OpenCV.js: ' + lastErr.message);
    const cv = await self.TagVisionFactory.ready(self.cv);
    self.cv = cv;
    V = self.TagVisionFactory(cv, self.TagCore);
    return cv;
  }

  // Only the search windows: the frame is drawn once and just the windows are read back and turned grey, each into
  // its own Mat (freed by the caller).
  // The grey pixels of a frame message: of each search window (m.rois), or of the whole picture. A VideoFrame (WebCodecs)
  // is read directly, and only the parts needed: in a webcam's own YUV format the first plane is already grey (luma), so
  // nothing is converted; RGB frames (the demo's canvases) are converted. Anything else, or an ImageBitmap from a
  // browser without WebCodecs, goes through a canvas. Returns {parts: [{img, x, y, own}], w, h, whole, via}.
  const LUMA = new Set(['I420', 'I420A', 'I422', 'I444', 'NV12']), RGB = { RGBA: [0, 1, 2], RGBX: [0, 1, 2], BGRA: [2, 1, 0], BGRX: [2, 1, 0] };
  async function grey(m) {
    const rois = m.mode !== 'calib' && m.rois && m.rois.length ? m.rois : null;
    const f = m.frame;
    if (f) {
      const vr = f.visibleRect, W = vr.width, H = vr.height, fmt = f.format;
      if (LUMA.has(fmt) || RGB[fmt]) {
        try {
          // chroma is sampled every second pixel, so a window starts and ends on even pixels
          const even = (r) => { const x = r.x & ~1, y = r.y & ~1; return { x, y, w: Math.min(W & ~1, (r.x + r.w + 1) & ~1) - x, h: Math.min(H & ~1, (r.y + r.h + 1) & ~1) - y }; };
          const list = rois ? rois.map(even) : [{ x: 0, y: 0, w: W, h: H }], parts = [];
          for (const r of list) parts.push({ img: await greyRect(f, vr, r, fmt), x: r.x, y: r.y, own: true });
          return { parts, w: W, h: H, whole: !rois, via: fmt };
        } finally { f.close(); }
      }
    }
    const pic = f || m.bitmap;
    if (rois) { const win = windows(pic, rois); return { parts: win.parts.map((q) => Object.assign(q, { own: true })), w: win.w, h: win.h, whole: false, via: 'canvas' }; }
    const px = pixels(pic);
    return { parts: [{ img: V.setRGBA(px.rgba, px.w, px.h), x: 0, y: 0, own: false }], w: px.w, h: px.h, whole: true, via: 'canvas' };
  }
  async function greyRect(f, vr, r, fmt) {
    const rect = { x: vr.x + r.x, y: vr.y + r.y, width: r.w, height: r.h };
    const buf = new Uint8Array(f.allocationSize({ rect })), lay = await f.copyTo(buf, { rect });
    const g = new self.cv.Mat(r.h, r.w, self.cv.CV_8UC1), o = g.data, off = lay[0].offset, st = lay[0].stride;
    if (LUMA.has(fmt)) {
      if (st === r.w) o.set(buf.subarray(off, off + r.w * r.h));
      else for (let y = 0; y < r.h; y++) o.set(buf.subarray(off + y * st, off + y * st + r.w), y * r.w);
    } else {
      const [a, b, c] = RGB[fmt];
      for (let y = 0, i = 0; y < r.h; y++) for (let x = 0, j = off + y * st; x < r.w; x++, j += 4, i++) o[i] = (buf[j + a] * 77 + buf[j + b] * 150 + buf[j + c] * 29) >> 8;
    }
    return g;
  }
  function windows(bitmap, rois) {
    const w = bitmap.displayWidth || bitmap.width, h = bitmap.displayHeight || bitmap.height;
    if (!canvas || canvas.width !== w || canvas.height !== h) { canvas = new OffscreenCanvas(w, h); ctx = canvas.getContext('2d', { willReadFrequently: true }); }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const parts = rois.map((r) => {
      const d = ctx.getImageData(r.x, r.y, r.w, r.h).data, g = new self.cv.Mat(r.h, r.w, self.cv.CV_8UC1), o = g.data;
      for (let i = 0, j = 0; i < r.w * r.h; i++, j += 4) o[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
      return { img: g, x: r.x, y: r.y };
    });
    return { parts, w, h };
  }
  function pixels(bitmap) {
    const w = bitmap.displayWidth || bitmap.width, h = bitmap.displayHeight || bitmap.height;
    if (!canvas || canvas.width !== w || canvas.height !== h) { canvas = new OffscreenCanvas(w, h); ctx = canvas.getContext('2d', { willReadFrequently: true }); }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return { rgba: ctx.getImageData(0, 0, w, h).data, w, h };
  }

  self.onmessage = async (ev) => {
    const m = ev.data;
    try {
      if (m.type === 'init') {
        post({ type: 'status', text: 'Loading OpenCV…' });
        const cv = await load();
        V.setFamily(m.family, m.quality);
        post({ type: 'ready', version: (cv.getBuildInformation().match(/Version control:\s*(\S+)/) || [])[1] || '', count: V.familySize(m.family) });
      } else if (!V) {
        if (m.bitmap) m.bitmap.close();
        if (m.frame) m.frame.close();
      } else if (m.type === 'family') {
        V.setFamily(m.family, m.quality);
        post({ type: 'family', family: m.family, count: V.familySize(m.family) });
      } else if (m.type === 'frame') {
        const t0 = performance.now(), src = await grey(m);
        try {
          if (m.mode === 'calib') {
            const img = src.parts[0].img, b = V.detectBoard(img), pose = m.square ? V.boardPose(b.ids, b.pts, m.cam, m.square) : null;
            post({ type: 'board', src: m.src, seq: m.seq, time: m.time, w: src.w, h: src.h, ms: performance.now() - t0, ids: b.ids, pts: b.pts, markers: b.markers, pose });
          } else {
            const r = V.track(src.whole ? src.parts[0].img : src.parts, m.cam, m.sizes, m.defaultSize, m.bodies, m.raw, m.learn);
            const searched = src.whole ? 1 : src.parts.reduce((a, q) => a + q.img.rows * q.img.cols, 0) / (src.w * src.h);
            post({ type: 'tags', src: m.src, seq: m.seq, time: m.time, w: src.w, h: src.h, ms: performance.now() - t0, tags: r.tags, bodies: r.bodies, rois: src.whole ? null : m.rois, searched });
          }
        } finally { for (const q of src.parts) if (q.own) q.img.delete(); }
      } else if (m.type === 'calibrate') {
        const c = V.calibrate(m.views, m.w, m.h, m.square);
        post({ type: 'calibrated', calib: c });
      } else if (m.type === 'boardImage') {
        const b = V.boardImage(m.px);
        post({ type: 'boardImage', img: b, purpose: m.purpose }, [b.data.buffer]);
      } else if (m.type === 'tagImage') {
        const b = V.tagImage(m.family, m.id, m.px);
        post({ type: 'tagImage', img: b, id: m.id, purpose: m.purpose }, [b.data.buffer]);
      }
    } catch (e) {
      for (const x of [m.bitmap, m.frame]) if (x) try { x.close(); } catch (_) { /* already closed */ }
      post({ type: 'error', of: m.type, src: m.src, seq: m.seq, text: String((e && e.message) || e) });
    }
  };
})();
