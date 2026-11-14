// Run with task shot -- /haptography/ --eval-file tests/haptography/browser.js --full
(async () => {
  const $ = id => document.getElementById(id);
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const wait = async (condition, name, timeout = 15000) => {
    const until = Date.now() + timeout;
    while (!condition()) {
      if (Date.now() > until) throw new Error(`Timed out: ${name}; ${$('actuator-status').textContent}`);
      await new Promise(r => setTimeout(r, 100));
    }
  };
  await wait(() => $('takes') && $('demo') && $('signal-summary').textContent, 'studio ready');
  // Recording requires labels, and its keyboard path shares that validation.
  $('demo').click(); $('record').click();
  assert($('rec-status').textContent.includes('Name the dataset'), 'unlabelled takes need explicit quick capture');
  $('rec-dataset').value = 'Browser checks'; $('rec-label').value = 'Cork'; $('rec-setup').value = 'Fixed grip';
  $('record').click();
  assert($('record').textContent === 'Stop', 'recording starts');
  await wait(() => $('coach-state').textContent.includes('Slide'), 'stillness completion', 8000);
  await new Promise(r => setTimeout(r, 5500));
  $('record').click();
  await wait(() => !$('after-record').hidden, 'take saved');
  assert($('storage-note').textContent.includes('not exported'), 'local storage state visible');
  assert($('coverage-bins').textContent.includes('mm/s'), 'speed coverage available');
  $('inspect-take').click();
  await wait(() => $('stroke-list').querySelector('button'), 'stroke detection');
  assert(document.body.dataset.workspace === 'collect' && document.body.dataset.mode === 'replay', 'a take replays in Record');
  assert(!$('selection-tools').hidden && !$('transport').hidden, 'replay tools shown');
  assert(getComputedStyle(document.querySelector('.score-section')).display !== 'none', 'replayed take shows its quality');
  $('stroke-list').querySelector('button').click();
  await wait(() => !$('create-target').disabled && !$('play-board').disabled, 'selection ready');
  // Demo has no actuator: the selection plays on the speakers.
  $('play-board').click();
  await wait(() => $('replay-status').textContent.includes('speakers'), 'selection played on speakers');
  assert(Number($('selection-end').value) > Number($('selection-start').value), 'selection is editable');
  $('exclude-selection').click(); await new Promise(r => setTimeout(r, 150));
  assert($('spans').textContent.includes('bad'), 'exclusion preserved as a label');
  $('undo-label').click(); await new Promise(r => setTimeout(r, 150));
  assert(!$('spans').textContent.includes('bad'), 'exclusion can be undone');
  $('create-target').click();
  assert(document.body.dataset.workspace === 'recreate', 'selection opens in Recreate');
  assert($('signal-kind').value === 'recording', 'recorded target source');
  assert($('signal-summary').textContent.includes('Uncalibrated'), 'uncalibrated status is explicit');
  const before = $('signal-strength').value;
  $('signal-strength').value = '25'; $('signal-strength').dispatchEvent(new Event('change', { bubbles: true }));
  $('undo-tuning').click(); assert($('signal-strength').value === before, 'tuning undo restores previous settings');
  document.querySelector('.profile-panel').open = true;
  $('profile-note').value = 'Simulated housing on foam'; $('measure-profile').click();
  await wait(() => $('profile-state').textContent.includes('Simulated') && !$('play-actuators').disabled, 'actuator profile', 20000);
  assert($('signal-summary').textContent.includes('Profile-compensated'), 'profile applied');
  $('play-actuators').click();
  await wait(() => !$('comparison-panel').hidden && !$('save-variant').disabled && $('stop-actuators').disabled, 'playback and comparison');
  assert($('metric-band').textContent !== '—', 'recording comparison has a band error');
  assert($('measurement-kind').textContent === 'Simulated response', 'simulated response labelled');
  assert($('variants').querySelectorAll('li').length === 1, 'round saved');
  $('refine-drive').click();
  assert(document.body.dataset.workspace === 'recreate' && $('comparison-panel').hidden, 'refinement clears the old measurement');
  assert($('signal-summary').textContent.includes('not yet played'), 'refinement clears stale measurement state');
  $('play-actuators').click();
  await wait(() => $('variants').querySelectorAll('li').length === 2 && !$('save-variant').disabled && $('stop-actuators').disabled, 'corrected measurement');
  assert($('variants').querySelectorAll('li').length === 2, 'both rounds retained');
  $('duplicate-variant').click();
  await wait(() => $('variants').querySelectorAll('li').length === 3, 'duplicate');
  $('variant-notes').value = 'Less sharp'; $('prefer-variant').checked = true; $('update-assessment').click();
  await wait(() => $('variants').textContent.includes('Less sharp'), 'assessment');
  $('play-a').click(); await wait(() => !$('stop-actuators').disabled, 'A/B started'); $('stop-actuators').click();
  await wait(() => $('stop-actuators').disabled, 'stop completes');
  assert($('variants').querySelectorAll('li').length === 3, 'stopping A/B keeps saved variants');
  // Export through an in-memory folder, then import that exact JSON through the file input.
  // This verifies the real UI serialization, including typed arrays and model profiles.
  const exports = new Map();
  window.showDirectoryPicker = async () => ({ getFileHandle: async name => ({ createWritable: async () => ({ write: async data => exports.set(name, data), close: async () => {} }) }) });
  $('export-experiment').click();
  await wait(() => $('experiment-storage').textContent === 'Experiment exported' && exports.size >= 4, 'experiment export');
  const exported = exports.get('experiment.json');
  assert(JSON.parse(exported).variants.length === 3, 'all variants exported');
  assert([...exports.keys()].filter(name => name.endsWith('-drive.wav')).length === 3, 'playable WAV for each variant');
  const transfer = new DataTransfer(); transfer.items.add(new File([exported], 'experiment.json', { type: 'application/json' }));
  $('experiment-input').files = transfer.files; $('experiment-input').dispatchEvent(new Event('change'));
  await wait(() => $('variants').querySelectorAll('li').length === 6, 'experiment import');
  const malformed = JSON.parse(exported); delete malformed.variants[0].about;
  const badTransfer = new DataTransfer(); badTransfer.items.add(new File([JSON.stringify(malformed)], 'bad.json', { type: 'application/json' }));
  $('experiment-input').files = badTransfer.files; $('experiment-input').dispatchEvent(new Event('change'));
  await wait(() => $('actuator-status').textContent.includes('invalid source'), 'invalid import rejected');
  assert($('variants').querySelectorAll('li').length === 6, 'invalid import leaves existing experiments intact');
  // IndexedDB, rather than a transient in-memory list, owns the completed experiment.
  await new Promise(r => setTimeout(r, 600));
  const db = await new Promise((resolve, reject) => { const r = indexedDB.open('haptography'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  const saved = await new Promise((resolve, reject) => { const r = db.transaction('studio').objectStore('studio').get('studio'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  assert(saved.variants.length === 6 && saved.variants.some(v => v.notes === 'Less sharp'), 'experiment persisted');
  db.close();
  // Library: the catalog, favorites (kept in IndexedDB), speaker playback in Demo, saved versions, export.
  $('tab-library').click();
  assert(!document.querySelector('.waveforms-section').hidden && document.querySelector('.studio-section').hidden, 'Library workspace');
  const cards = () => $('waveform-grid').querySelectorAll('.wave-card');
  assert(cards().length >= 30, 'catalog tiles');
  await new Promise(r => setTimeout(r, 100));
  const spark = cards()[0].querySelector('canvas');
  assert(spark.width > 0 && spark.width === Math.round(spark.clientWidth * devicePixelRatio), 'sparkline buffer follows its CSS size');
  cards()[0].querySelector('.star').click(); cards()[3].querySelector('.star').click();
  document.querySelector('input[name=lib-filter][value=favorites]').click();
  assert(cards().length === 2, 'favorites filter');
  cards()[0].querySelector('.wave-play').click();
  await wait(() => $('lib-play-status').textContent.includes('speakers'), 'library tile plays on the speakers in Demo');
  $('speakers').click();
  cards()[0].querySelector('.wave-play').click();
  assert($('lib-play-status').className.includes('bad'), 'with Speakers off and no board, it says how to hear it');
  $('speakers').click();
  document.querySelector('input[name=lib-filter][value=recordings]').click();
  assert(cards().length === 6, 'saved Recreate versions are in the Library');
  cards()[0].querySelector('.star').click();
  document.querySelector('input[name=lib-filter][value=impacts]').click();
  assert([...cards()].every(c => !c.dataset.id.startsWith('v:')) && cards().length >= 5, 'group filter');
  exports.clear();
  $('lib-export').click();
  await wait(() => exports.has('library.json') && exports.size === 4, 'favorites export');
  const lib = JSON.parse(exports.get('library.json'));
  assert(lib.format === 'haptography-library/1' && lib.waveforms.length === 3 && lib.waveforms.some(w => w.source === 'recording'), 'export lists catalog and recorded favorites');
  await new Promise(r => setTimeout(r, 300));
  const db2 = await new Promise((resolve, reject) => { const r = indexedDB.open('haptography'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  const favs = await new Promise((resolve, reject) => { const r = db2.transaction('studio').objectStore('studio').get('library'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  assert(favs.favorites.length === 3, 'favorites persisted');
  db2.close();
  // All workspaces fit horizontally at the test viewport.
  for (const name of ['collect', 'library', 'recreate']) {
    $('tab-' + name).click();
    assert(document.documentElement.scrollWidth <= innerWidth, name + ' does not overflow horizontally');
  }
  $('tab-library').click(); document.querySelector('input[name=lib-filter][value=all]').click();
  return { result: 'PASS', takes: $('takes').querySelectorAll('.take').length, variants: saved.variants.length, bandError: $('metric-band').textContent, waveforms: cards().length };
})()
