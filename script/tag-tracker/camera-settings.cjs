// Capture preferences and shutter verification, using capability-shaped fixtures without a camera.
module.exports = function ({ check }) {
  const C = require('../../tag-tracker/camera-core');
  check(C.normalizeFps('30') === '30' && C.normalizeFps('60') === '60' && C.normalizeFps('max') === 'max', 'camera frame-rate preferences accept their three supported choices');
  check([undefined, null, '', '120', 30, {}, NaN].every((v) => C.normalizeFps(v) === 'max'), 'unknown camera frame-rate preferences fall back to highest available');
  const low = C.constraints('640x360', 'max', { frameRate: { min: 1, max: 30 } });
  check(low.width.ideal === 640 && low.height.ideal === 360 && low.frameRate.ideal === 30, 'the lower 16:9 capture option preserves aspect ratio and respects a 30 fps camera');
  check(C.constraints('1280x720', '60', { frameRate: { min: 1, max: 30 } }).frameRate.ideal === 30, 'a preferred 60 fps request stays inside the reported camera range');
  check(C.constraints('1920x1080', 'max', { frameRate: { min: 15, max: 120 } }).frameRate.ideal === 120, 'highest available requests the reported maximum rather than assuming 60 fps');
  check(C.constraints('640x480', '30', { frameRate: { min: 50, max: 120 } }).frameRate.ideal === 50, 'a preferred rate below the camera minimum is raised to the supported minimum');
  check(C.constraints('bad', 'bad', null).width.ideal === 1280 && C.constraints('bad', 'bad', null).height.ideal === 720 && C.constraints('bad', 'bad', null).frameRate.ideal === 60, 'missing capabilities and malformed saved settings use soft 720p60 preferences');
  check([null, {}, { frameRate: {} }, { frameRate: { min: 100, max: 30 } }, { frameRate: { min: NaN, max: Infinity } }, { frameRate: { max: '30' } }].every((caps) => C.constraints('1280x720', 'max', caps).frameRate.ideal === 60), 'malformed frame-rate capability ranges cannot produce invalid requests');
  const partial = C.constraints('1280x720', 'max', { frameRate: { max: 30 } });
  check(partial.frameRate.ideal === 30 && C.constraints('1280x720', '30', { frameRate: { min: 60 } }).frameRate.ideal === 60, 'partial numeric frame-rate ranges remain usable');

  const caps = { exposureMode: ['continuous', 'manual'], exposureTime: { min: 1, max: 1000, step: 1 } };
  const opts = C.exposureOptions(caps), shutter120 = C.exposureRequest(caps, '120'), shutter250 = C.exposureRequest(caps, '250');
  check(opts.map((o) => o.value).join(',') === 'auto,120,250' && shutter120.exposureMode === 'manual' && shutter120.exposureTime === 83 && shutter250.exposureTime === 40, 'manual shutters convert seconds to 100 microsecond units and quantize to the camera step');
  check(C.exposureRequest(caps, 'auto').exposureMode === 'continuous' && C.exposureRequest(caps, '500') === null, 'automatic exposure uses a supported continuous mode and unknown shutters are refused');
  const coarse = { exposureMode: ['manual', 'continuous'], exposureTime: { min: 10, max: 88, step: 25 } };
  check(C.exposureRequest(coarse, '120').exposureTime === 85 && C.exposureRequest(coarse, '250').exposureTime === 35, 'shutter quantization is based on the advertised minimum rather than zero');
  const edge = { exposureMode: ['manual', 'continuous'], exposureTime: { min: 10, max: 84, step: 25 } };
  check(C.exposureRequest(edge, '120').exposureTime === 60, 'rounding near the upper exposure limit stays on an advertised step');
  check(C.exposureOptions({ exposureMode: ['manual', 'continuous'], exposureTime: { min: 0, max: 1000, step: 1000 } }).length === 1, 'coarse exposure steps cannot advertise a zero-duration shutter');
  const limited = { exposureMode: ['manual', 'continuous'], exposureTime: { min: 50, max: 90 } };
  check(C.exposureOptions(limited).map((o) => o.value).join(',') === 'auto,120' && C.exposureRequest(limited, '250') === null, 'shutters outside the exposure range are hidden rather than silently clamped');
  check(Math.abs(C.exposureRequest(limited, '120').exposureTime - 10000 / 120) < 1e-10, 'continuous exposure ranges preserve fractional shutter durations');
  const malformed = [null, {}, { exposureMode: ['continuous'] }, { exposureMode: ['manual'] }, { exposureMode: 'manual', exposureTime: { min: 1, max: 1000 } }, { ...caps, exposureTime: { min: 1000, max: 1 } }, { ...caps, exposureTime: { min: -1, max: 1000 } }, { ...caps, exposureTime: { min: 1, max: NaN } }];
  check(malformed.every((c) => C.exposureOptions(c).length === 1 && C.exposureRequest(c, '120') === null), 'absent, unsupported or malformed exposure capabilities never advertise manual shutters');
  check(C.exposureRequest({}, 'auto') === null && C.exposureRequest({ exposureMode: ['manual'] }, 'auto') === null, 'automatic exposure is not requested on devices lacking continuous mode');
  check(C.exposureMatches({ exposureMode: 'manual', exposureTime: 83 }, shutter120, caps) && C.exposureMatches({ exposureMode: 'manual', exposureTime: 83.1 }, shutter120, caps), 'verified manual settings allow small numeric readback rounding');
  check(!C.exposureMatches({ exposureMode: 'continuous', exposureTime: 83 }, shutter120, caps) && !C.exposureMatches({ exposureMode: 'manual', exposureTime: 333 }, shutter120, caps), 'silently ignored mode or exposure changes cannot be reported as applied');
  check(!C.exposureMatches({}, shutter120, caps) && !C.exposureMatches({ exposureMode: 'manual', exposureTime: NaN }, shutter120, caps) && !C.exposureMatches({ exposureMode: 'manual', exposureTime: 83 }, null, caps), 'missing or invalid exposure readback fails verification');
  check(C.exposureMatches({ exposureMode: 'continuous' }, { exposureMode: 'continuous' }, caps) && !C.exposureMatches({ exposureMode: 'manual' }, { exposureMode: 'continuous' }, caps), 'automatic exposure is verified against the actual camera mode');
  const req = C.exposureRequest(caps, '120'); req.exposureTime = 999;
  check(C.exposureRequest(caps, '120').exposureTime === 83 && caps.exposureTime.min === 1, 'constructing camera requests never mutates capabilities or later requests');

  const original = {
    width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 },
    advanced: [{ focusMode: 'manual', focusDistance: 0.8 }, { exposureMode: 'manual', exposureTime: 333, whiteBalanceMode: 'continuous' }],
  };
  const before = JSON.stringify(original), change = { exposureMode: 'manual', exposureTime: 83 };
  const merged = C.mergeConstraints(original, change);
  check(merged.width.ideal === 1280 && merged.height.ideal === 720 && merged.frameRate.ideal === 60 && merged.advanced[0].focusMode === 'manual' && merged.advanced[0].focusDistance === 0.8, 'changing exposure preserves capture dimensions, frame rate and manual focus');
  check(merged.advanced.length === 3 && merged.advanced[1].whiteBalanceMode === 'continuous' && !('exposureMode' in merged.advanced[1]) && !('exposureTime' in merged.advanced[1]) && merged.advanced[2].exposureTime === 83, 'new exposure controls replace old keys without losing unrelated controls in their group');
  check(JSON.stringify(original) === before && change.exposureTime === 83 && merged.advanced !== original.advanced && merged.advanced[0] !== original.advanced[0] && merged.advanced[2] !== change, 'merging camera constraints never mutates input groups or the supplied change');
  const automatic = C.mergeConstraints({ ...original, exposureMode: 'manual', exposureTime: 100 }, { exposureMode: 'continuous' });
  check(!('exposureMode' in automatic) && !('exposureTime' in automatic) && automatic.advanced.every((g) => !('exposureTime' in g)) && automatic.advanced.at(-1).exposureMode === 'continuous', 'restoring auto exposure clears manual mode and shutter from basics and advanced groups');
  const focused = C.mergeConstraints({ ...original, focusMode: 'manual', focusDistance: 2 }, { focusMode: 'continuous' });
  check(!('focusMode' in focused) && !('focusDistance' in focused) && focused.advanced.length === 2 && focused.advanced.every((g) => !('focusDistance' in g)) && focused.advanced[0].exposureTime === 333 && focused.advanced[1].focusMode === 'continuous', 'restoring autofocus clears old focus constraints while preserving exposure');
  const replacement = C.mergeConstraints({ width: 1280, frameRate: { ideal: 30 }, advanced: [{ frameRate: 30, zoom: 1 }] }, { frameRate: 60 });
  check(!('frameRate' in replacement) && replacement.width === 1280 && replacement.advanced.length === 2 && replacement.advanced[0].zoom === 1 && !('frameRate' in replacement.advanced[0]) && replacement.advanced[1].frameRate === 60, 'a new advanced key removes conflicting basic and advanced values');
  const inherited = Object.create({ advanced: [{ focusMode: 'manual' }], height: 999 }); inherited.width = 640;
  const inheritedChange = Object.create({ exposureMode: 'manual' }); inheritedChange.zoom = 2;
  const own = C.mergeConstraints(inherited, inheritedChange);
  check(own.width === 640 && !('height' in own) && own.advanced.length === 1 && own.advanced[0].zoom === 2 && !('exposureMode' in own.advanced[0]), 'constraint merging uses only own fields, never inherited camera controls');
  check(C.mergeConstraints(undefined, { exposureMode: 'continuous' }).advanced[0].exposureMode === 'continuous' && C.mergeConstraints({ advanced: [null, [], {}, 7] }).advanced.length === 0, 'missing current constraints and malformed advanced groups remain safe');
};

if (require.main === module) {
  let failures = 0;
  module.exports({ check(ok, message) { console.log((ok ? '  ok   ' : '  FAIL ') + message); if (!ok) failures++; } });
  process.exitCode = failures ? 1 : 0;
}
