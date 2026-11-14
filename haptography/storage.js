// The library, kept in this browser's IndexedDB: each take's labels and summary, its raw bytes,
// and the spool a recording writes every few seconds so a closed or crashed page's recording can
// be saved on the next visit. Falls back to memory when IndexedDB is unavailable (a private
// window, blocked storage): the page still works, it just forgets on reload.

const DB_NAME = "haptography";
const DB_VERSION = 2;

function request(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

class IdbStore {
  constructor(db) {
    this.db = db;
    this.persistent = true;
  }

  static async open() {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("takes")) db.createObjectStore("takes", { keyPath: "id" });
      if (!db.objectStoreNames.contains("raw")) db.createObjectStore("raw", { keyPath: "id" });
      if (!db.objectStoreNames.contains("spool")) db.createObjectStore("spool", { keyPath: "key" });
      if (!db.objectStoreNames.contains("studio")) db.createObjectStore("studio");
    };
    let blocked = false;
    const db = await new Promise((resolve, reject) => {
      open.onblocked = () => { blocked = true; reject(new Error("Close older Haptography tabs to upgrade storage.")); };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => { if (blocked) open.result.close(); else resolve(open.result); };
    });
    db.onversionchange = () => db.close();
    return new IdbStore(db);
  }

  tx(store, mode = "readonly") {
    return this.db.transaction(store, mode).objectStore(store);
  }

  listTakes() { return request(this.tx("takes").getAll()); }
  getState(key) { return request(this.tx("studio").get(key)); }
  putState(key, value) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("studio", "readwrite");
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Studio save interrupted."));
      tx.objectStore("studio").put(value, key);
    });
  }
  putTake(meta) { return request(this.tx("takes", "readwrite").put(meta)); }
  async getRaw(id) {
    const row = await request(this.tx("raw").get(id));
    return row ? new Uint8Array(await new Blob([row.bytes]).arrayBuffer()) : null;
  }
  putRaw(id, bytes) { return request(this.tx("raw", "readwrite").put({ id, bytes: new Blob([bytes]) })); }
  async deleteTake(id) {
    const t = this.db.transaction(["takes", "raw"], "readwrite");
    t.objectStore("takes").delete(id);
    t.objectStore("raw").delete(id);
    await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error); });
  }

  spoolAppend(take, n, bytes, meta) {
    return request(this.tx("spool", "readwrite").put({ key: `${take}:${String(n).padStart(6, "0")}`, take, n, bytes: new Blob([bytes]), meta }));
  }
  /** Unsaved recordings: [{take, meta, bytes}] */
  async spooled() {
    const rows = await request(this.tx("spool").getAll());
    const byTake = new Map();
    for (const r of rows) {
      if (!byTake.has(r.take)) byTake.set(r.take, []);
      byTake.get(r.take).push(r);
    }
    const out = [];
    for (const [take, list] of byTake) {
      list.sort((a, b) => a.n - b.n);
      const bytes = new Uint8Array(await new Blob(list.map((r) => r.bytes)).arrayBuffer());
      out.push({ take, meta: list.find((r) => r.meta)?.meta ?? null, bytes });
    }
    return out;
  }
  async spoolClear(take) {
    const store = this.tx("spool", "readwrite");
    const range = IDBKeyRange.bound(`${take}:`, `${take}:￿`);
    await request(store.delete(range));
  }
}

class MemoryStore {
  constructor() {
    this.persistent = false;
    this.takes = new Map();
    this.raw = new Map();
    this.state = new Map();
  }
  async listTakes() { return [...this.takes.values()]; }
  async getState(key) { return structuredClone(this.state.get(key)); }
  async putState(key, value) { this.state.set(key, structuredClone(value)); }
  async putTake(meta) { this.takes.set(meta.id, structuredClone(meta)); }
  async getRaw(id) { return this.raw.get(id) ?? null; }
  async putRaw(id, bytes) { this.raw.set(id, bytes); }
  async deleteTake(id) { this.takes.delete(id); this.raw.delete(id); }
  async spoolAppend() {}
  async spooled() { return []; }
  async spoolClear() {}
}

export async function openStore() {
  try {
    return await IdbStore.open();
  } catch {
    return new MemoryStore();
  }
}
