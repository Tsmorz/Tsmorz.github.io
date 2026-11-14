(async () => {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const request = r => new Promise((yes, no) => { r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error); });
  while (!document.getElementById('signal-summary')?.textContent) await new Promise(resolve => setTimeout(resolve, 50));
  const { openStore } = await import('/haptography/storage.js');
  const store = await openStore();
  assert(store.persistent, 'persistent studio storage');
  await store.putTake({ id: 'collision', label: 'Studio take', bytes: 1 });
  await store.putRaw('collision', new Uint8Array([9]));
  const r = indexedDB.open('haptography-bench', 1);
  r.onupgradeneeded = () => { for (const [name, keyPath] of [['takes','id'], ['raw','id'], ['spool','key']]) r.result.createObjectStore(name, { keyPath }); };
  const legacy = await request(r);
  await new Promise((yes, no) => {
    const tx = legacy.transaction(['takes', 'raw', 'spool'], 'readwrite');
    tx.oncomplete = yes; tx.onerror = () => no(tx.error);
    tx.objectStore('takes').put({ id: 'collision', label: 'Bench take', bytes: 3 });
    tx.objectStore('raw').put({ id: 'collision', bytes: new Blob([new Uint8Array([1,2,3])]) });
    tx.objectStore('spool').put({ key: 'unsaved:000000', take: 'unsaved', n: 0, bytes: new Blob([new Uint8Array([4,5])]), meta: { label: 'Interrupted bench take' } });
  });
  await store.importBench(); await store.importBench();
  const takes = await store.listTakes();
  assert(takes.filter(t => t.id === 'bench:collision').length === 1, 'bench import is idempotent');
  assert(takes.find(t => t.id === 'collision').label === 'Studio take', 'studio identity collision is preserved');
  assert((await store.getRaw('collision'))[0] === 9, 'studio raw bytes are preserved');
  assert(String(await store.getRaw('bench:collision')) === '1,2,3', 'bench raw bytes are retained');
  const recovery = (await store.spooled()).find(row => row.take === 'bench:unsaved');
  assert(String(recovery.bytes) === '4,5' && recovery.meta.label === 'Interrupted bench take', 'unsaved bench recording can be recovered');
  const original = await request(legacy.transaction('raw').objectStore('raw').get('collision'));
  assert(String(new Uint8Array(await original.bytes.arrayBuffer())) === '1,2,3', 'legacy originals are not removed');
  legacy.close();
  const db = await request(indexedDB.open('haptography'));
  assert(db.objectStoreNames.contains('studio'), 'studio schema remains intact'); db.close();
  return { result: 'PASS', imported: 'bench:collision', recovery: recovery.take };
})()
