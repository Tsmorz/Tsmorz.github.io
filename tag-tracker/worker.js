// The OpenCV side of /tag-tracker/, run in a Web Worker so detection never stalls the page.
// TagVision (no DOM, no worker globals) does the work and is what script/test-tag-tracker drives in Node;
// the bottom of the file wraps it in worker messages.
//
// Tracking: OpenCV's ArUco detector with an AprilTag dictionary and AprilTag corner refinement, then one
// solvePnP (IPPE_SQUARE) per tag with that tag's printed size.
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
  // ids not in it use defaultSize.
  function detectTags(img, cam, sizes, defaultSize) {
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
        for (let k = 0; k < 8; k++) cd[k] -= 0.5;
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

  return { FAMILIES, BOARD, QUALITY, setFamily, setRGBA, setGray, detectTags, detectBoard, boardImage, tagImage, familySize, calibrate };
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

  function pixels(bitmap) {
    const w = bitmap.width, h = bitmap.height;
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
      } else if (m.type === 'family') {
        V.setFamily(m.family, m.quality);
        post({ type: 'family', family: m.family, count: V.familySize(m.family) });
      } else if (m.type === 'frame') {
        const t0 = performance.now(), px = pixels(m.bitmap), img = V.setRGBA(px.rgba, px.w, px.h);
        if (m.mode === 'calib') {
          const b = V.detectBoard(img);
          post({ type: 'board', seq: m.seq, time: m.time, w: px.w, h: px.h, ms: performance.now() - t0, ids: b.ids, pts: b.pts, markers: b.markers });
        } else {
          const tags = V.detectTags(img, m.cam, m.sizes, m.defaultSize);
          post({ type: 'tags', seq: m.seq, time: m.time, w: px.w, h: px.h, ms: performance.now() - t0, tags });
        }
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
      if (m.bitmap) try { m.bitmap.close(); } catch (_) { /* already closed */ }
      post({ type: 'error', of: m.type, seq: m.seq, text: String((e && e.message) || e) });
    }
  };
})();
