// Camera preferences and capability-gated shutter controls. Merely opening Settings never acquires a stream.
'use strict';

const cameraCaptureCore = window.TagCameraCore;
function cameraCaptureText(key, values = {}) {
  return TASK_DATA.camera_capture[key].replace(/\{(\w+)\}/g, (_, k) => String(values[k]));
}
function cameraCapabilities(track) {
  try { return track.getCapabilities ? track.getCapabilities() : {}; } catch (_) { return {}; }
}
function cameraSettings(track) {
  try { return track.getSettings ? track.getSettings() : {}; } catch (_) { return {}; }
}
function cameraCaptureLive(c) { return !c.gone && S.cams.includes(c); }
function cameraExposureValue(c, settings) {
  if (settings.exposureMode === 'continuous') return 'auto';
  const option = cameraCaptureCore.exposureOptions(c.captureCaps).find((q) => q.request && cameraCaptureCore.exposureMatches(settings, q.request, c.captureCaps));
  return option ? option.value : 'current';
}
async function configureCameraCapture(c) {
  if (c.demo !== null || !cameraCaptureLive(c)) return;
  c.captureCaps = cameraCapabilities(c.track);
  const wanted = cameraCaptureCore.constraints(S.res, S.captureFps, c.captureCaps);
  const requested = cameraCaptureCore.constraints(S.res, S.captureFps);
  const current = cameraSettings(c.track);
  // The first request cannot know this camera's frame-rate range. Refine it once the stream exposes capabilities.
  if (wanted.frameRate.ideal !== requested.frameRate.ideal && current.frameRate !== wanted.frameRate.ideal && c.track.applyConstraints) {
    c.capturePending = true;
    try { await c.track.applyConstraints(wanted); }
    catch (_) { if (cameraCaptureLive(c)) c.captureNote = cameraCaptureText('frame_rate_failed'); }
    finally { c.capturePending = false; }
  }
  if (cameraCaptureLive(c)) refreshCameraSettings();
}
async function setCameraExposure(c, value) {
  if (!cameraCaptureLive(c) || c.capturePending) return;
  const request = cameraCaptureCore.exposureRequest(c.captureCaps, value);
  if (!request) return;
  c.capturePending = true; c.captureNote = '';
  refreshCameraSettings();
  try {
    // Extended camera controls are advisory in Chrome: read them back before showing success.
    await c.track.applyConstraints(cameraCaptureCore.mergeConstraints(c.track.getConstraints?.(), request));
    if (!cameraCaptureLive(c)) return;
    if (!cameraCaptureCore.exposureMatches(cameraSettings(c.track), request, c.captureCaps)) c.captureNote = cameraCaptureText('exposure_failed');
  } catch (_) {
    if (cameraCaptureLive(c)) c.captureNote = cameraCaptureText('exposure_failed');
  } finally {
    c.capturePending = false;
    if (cameraCaptureLive(c)) refreshCameraSettings(c);
  }
}
function refreshCameraSettings(exposureCamera) {
  $('cameraFps').value = S.captureFps;
  $('cameraResolution').value = S.res;
  const list = $('cameraCaptureList'), real = S.cams.filter((c) => c.demo === null);
  const keep = new Set(real.map((c) => c.captureRow));
  for (const row of [...list.children]) if (!keep.has(row)) row.remove();
  if (!real.length) {
    const p = document.createElement('p'); p.className = 'hint';
    p.textContent = cameraCaptureText(S.demo ? 'demo' : 'empty'); list.replaceChildren(p);
    return;
  }
  const text = TASK_DATA.camera_capture;
  for (const c of real) {
    if (!c.captureRow || c.captureRow.parentNode !== list) {
      const row = document.createElement('div'); row.className = 'camera-capture-row';
      row.innerHTML = `<strong></strong><p class="capture-info"></p><label class="field capture-exposure-field">${escapeHtml(text.exposure)} <select class="select sm capture-exposure"></select></label><p class="hint capture-help"></p><p class="capture-note" role="status"></p>`;
      row.querySelector('select').onchange = (e) => setCameraExposure(c, e.target.value);
      c.captureRow = row; list.appendChild(row);
    }
    const row = c.captureRow, caps = c.captureCaps || cameraCapabilities(c.track), settings = cameraSettings(c.track);
    c.captureCaps = caps;
    row.querySelector('strong').textContent = camName(c);
    const fps = (n) => Number.isFinite(n) && n > 0 ? String(Math.round(n * 10) / 10) : text.unknown;
    let info = cameraCaptureText('configured', { width: settings.width || c.video.videoWidth, height: settings.height || c.video.videoHeight, fps: fps(settings.frameRate) });
    if (c.stats.fps > 0) info += cameraCaptureText('delivered', { fps: fps(c.stats.fps), detection: fps(c.stats.dfps) });
    if (caps.frameRate?.max > 0) info += cameraCaptureText('maximum', { fps: fps(caps.frameRate.max) });
    row.querySelector('.capture-info').textContent = info;
    const options = cameraCaptureCore.exposureOptions(caps), supported = options.length > 1;
    row.querySelector('.capture-exposure-field').hidden = !supported;
    const select = row.querySelector('.capture-exposure');
    c.captureExposure = cameraExposureValue(c, settings);
    const choices = options.map((q) => [q.value, text.exposures.find((x) => x.value === q.value).label]);
    if (c.captureExposure === 'current') choices.unshift(['current', text.exposure_current]);
    const optionHtml = choices.map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join('');
    if (select.dataset.options !== optionHtml) { select.innerHTML = optionHtml; select.dataset.options = optionHtml; }
    if (document.activeElement !== select || c.capturePending || exposureCamera === c) select.value = c.captureExposure;
    select.disabled = !!c.capturePending;
    const ms = settings.exposureTime > 0 ? cameraCaptureText('exposure_actual', { ms: (settings.exposureTime / 10).toFixed(1) }) : '';
    row.querySelector('.capture-help').textContent = supported ? `${text.exposure_help}${ms ? ' ' + ms : ''}` : text.exposure_unavailable;
    row.querySelector('.capture-note').textContent = c.capturePending ? text.applying : c.captureNote || '';
  }
}
$('cameraFps').onchange = async () => {
  S.captureFps = cameraCaptureCore.normalizeFps($('cameraFps').value); store.set('captureFps', S.captureFps);
  if ((S.running || cameraStarting) && !S.demo) await start();
  refreshCameraSettings();
};
$('cameraResolution').onchange = () => {
  $('resSel').value = $('cameraResolution').value;
  $('resSel').onchange();
  refreshCameraSettings();
};
