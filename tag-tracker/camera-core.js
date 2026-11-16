// Camera capture preferences and optional shutter controls. No DOM or device access.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TagCameraCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RESOLUTIONS = new Set(['640x360', '640x480', '1280x720', '1920x1080']);
  const positive = (n) => Number.isFinite(n) && n > 0;
  const modes = (caps) => Array.isArray(caps?.exposureMode) ? caps.exposureMode : [];

  function normalizeFps(choice) { return ['30', '60', 'max'].includes(choice) ? choice : 'max'; }

  function constraints(res, choice, caps) {
    const [w, h] = (RESOLUTIONS.has(res) ? res : '1280x720').split('x').map(Number);
    const range = caps?.frameRate;
    let lo = positive(range?.min) ? range.min : 0, hi = positive(range?.max) ? range.max : Infinity;
    if (lo > hi) { lo = 0; hi = Infinity; }
    const selected = normalizeFps(choice), preferred = selected === 'max' ? (Number.isFinite(hi) ? hi : 60) : +selected;
    return { width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: Math.max(lo, Math.min(hi, preferred)) } };
  }

  function exposureOptions(caps) {
    const out = [{ value: 'auto' }], supported = modes(caps), range = caps?.exposureTime;
    if (!supported.includes('manual') || !supported.includes('continuous') ||
        !Number.isFinite(range?.min) || range.min < 0 || !positive(range?.max) || range.min > range.max) return out;
    for (const value of ['120', '250']) {
      // MediaTrack exposureTime is in 100 microsecond units, not seconds or milliseconds.
      const target = 10000 / +value;
      if (target < range.min || target > range.max) continue;
      let exposureTime = target;
      if (positive(range.step)) {
        const last = Math.floor((range.max - range.min) / range.step + 1e-9);
        const step = Math.max(0, Math.min(last, Math.round((target - range.min) / range.step)));
        exposureTime = Math.max(range.min, Math.min(range.max, range.min + step * range.step));
      }
      if (!positive(exposureTime)) continue;
      out.push({ value, exposureTime, request: { exposureMode: 'manual', exposureTime } });
    }
    return out;
  }

  function exposureRequest(caps, choice) {
    if (choice === 'auto') return modes(caps).includes('continuous') ? { exposureMode: 'continuous' } : null;
    const option = exposureOptions(caps).find((o) => o.value === choice);
    return option?.request ? Object.assign({}, option.request) : null;
  }

  function exposureMatches(settings, request, caps) {
    if (!request || settings?.exposureMode !== request.exposureMode) return false;
    if (request.exposureMode === 'continuous') return true;
    if (request.exposureMode !== 'manual' || !positive(request.exposureTime) || !positive(settings?.exposureTime)) return false;
    const step = positive(caps?.exposureTime?.step) ? caps.exposureTime.step : 0;
    const tolerance = Math.max(1e-4, request.exposureTime * 0.01, step * 0.01);
    return Math.abs(settings.exposureTime - request.exposureTime) <= tolerance;
  }

  // applyConstraints replaces the entire constraint set. Keep unrelated camera controls when changing one,
  // including advanced groups, but remove old modes and their dependent values before adding the new request.
  function mergeConstraints(current, advancedChange) {
    const entries = (value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : [];
    const change = Object.fromEntries(entries(advancedChange)), keys = new Set(Object.keys(change));
    if (keys.has('exposureMode')) { keys.add('exposureTime'); }
    if (keys.has('focusMode')) { keys.add('focusDistance'); }
    const source = Object.fromEntries(entries(current));
    const basic = Object.fromEntries(entries(source).filter(([key]) => key !== 'advanced' && !keys.has(key)));
    const advanced = (Array.isArray(source.advanced) ? source.advanced : []).map((group) =>
      Object.fromEntries(entries(group).filter(([key]) => !keys.has(key)))
    ).filter((group) => Object.keys(group).length);
    if (Object.keys(change).length) advanced.push(change);
    return { ...basic, advanced };
  }

  return { normalizeFps, constraints, exposureOptions, exposureRequest, exposureMatches, mergeConstraints };
});
