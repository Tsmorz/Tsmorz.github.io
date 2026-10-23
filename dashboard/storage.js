// The page's own storage in IndexedDB, which survives reloads and crashes: a small key-value store
// for what localStorage can't hold (the folder and file handles the page may use again), and the
// spool that live recordings go into as they arrive, so a page that closes mid-recording loses at
// most the last couple of seconds (app.js offers to save what's left). Where IndexedDB can't be
// opened, both fall back to memory: everything still works for that page load.

const DB_NAME = "nrf-dashboard";
const DB_VERSION = 1;

let opening = null;
function database() {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("kv");
      db.createObjectStore("spools", { keyPath: "id" });
      // Chunks of CSV rows, in the order they were added (the auto-incremented key), found by
      // spool, board and file.
      db.createObjectStore("chunks", { autoIncrement: true }).createIndex("part", ["spool", "member", "file"]);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return opening;
}

const settled = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const committed = (transaction) => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = transaction.onabort = () => reject(transaction.error);
});

// ---- key-value ------------------------------------------------------------------------------
const memoryKv = new Map();

/** A stored value, or undefined. */
export async function kvGet(key) {
  try {
    return await settled((await database()).transaction("kv").objectStore("kv").get(key));
  } catch {
    return memoryKv.get(key);
  }
}

/** Stores a value (anything structured-cloneable, file system handles included); undefined deletes it. */
export async function kvSet(key, value) {
  memoryKv.set(key, value);
  try {
    const transaction = (await database()).transaction("kv", "readwrite");
    if (value === undefined) transaction.objectStore("kv").delete(key);
    else transaction.objectStore("kv").put(value, key);
    await committed(transaction);
  } catch {
    /* storage blocked: kept for this page load */
  }
}

// ---- recording spool ----------------------------------------------------------------------
// A spool is { id, updated (epoch ms), ...whatever app.js keeps about the recording }, with its
// rows as chunks of CSV text per board (`member`) and file.

class IdbSpool {
  constructor(db) {
    this.db = db;
  }

  async create(record) {
    const spool = { ...record, id: `${Date.now()}`, updated: Date.now() };
    const transaction = this.db.transaction("spools", "readwrite");
    transaction.objectStore("spools").put(spool);
    await committed(transaction);
    return spool;
  }

  /** Adds chunks ([{ member, file, text }]) and marks the spool as written to now, in one go. */
  async append(id, chunks) {
    const transaction = this.db.transaction(["spools", "chunks"], "readwrite");
    const store = transaction.objectStore("chunks");
    for (const { member, file, text } of chunks) store.add({ spool: id, member, file, text });
    const spools = transaction.objectStore("spools");
    const spool = await settled(spools.get(id));
    if (spool) spools.put({ ...spool, updated: Date.now() });
    await committed(transaction);
  }

  async update(id, fields) {
    const transaction = this.db.transaction("spools", "readwrite");
    const spools = transaction.objectStore("spools");
    const spool = await settled(spools.get(id));
    if (spool) spools.put({ ...spool, ...fields, updated: Date.now() });
    await committed(transaction);
  }

  list() {
    return settled(this.db.transaction("spools").objectStore("spools").getAll());
  }

  /** One board's chunks of one file, in order. */
  chunks(id, member, file) {
    const index = this.db.transaction("chunks").objectStore("chunks").index("part");
    return settled(index.getAll([id, member, file])).then((rows) => rows.map((row) => row.text));
  }

  async remove(id) {
    const transaction = this.db.transaction(["spools", "chunks"], "readwrite");
    transaction.objectStore("spools").delete(id);
    const index = transaction.objectStore("chunks").index("part");
    const range = IDBKeyRange.bound([id], [id, []]);
    index.openKeyCursor(range).onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor) return;
      transaction.objectStore("chunks").delete(cursor.primaryKey);
      cursor.continue();
    };
    await committed(transaction);
  }
}

class MemorySpool {
  constructor() {
    this.spools = new Map();
    this.parts = new Map(); // `${id}/${member}/${file}` -> [text]
  }

  async create(record) {
    const spool = { ...record, id: `${Date.now()}`, updated: Date.now() };
    this.spools.set(spool.id, spool);
    return spool;
  }

  async append(id, chunks) {
    for (const { member, file, text } of chunks) {
      const key = `${id}/${member}/${file}`;
      if (!this.parts.has(key)) this.parts.set(key, []);
      this.parts.get(key).push(text);
    }
    await this.update(id, {});
  }

  async update(id, fields) {
    const spool = this.spools.get(id);
    if (spool) this.spools.set(id, { ...spool, ...fields, updated: Date.now() });
  }

  async list() {
    return [...this.spools.values()];
  }

  async chunks(id, member, file) {
    return this.parts.get(`${id}/${member}/${file}`) ?? [];
  }

  async remove(id) {
    this.spools.delete(id);
    for (const key of this.parts.keys()) if (key.startsWith(`${id}/`)) this.parts.delete(key);
  }
}

/** The recording spool: in IndexedDB, or in memory (lost on reload) if that can't be opened. */
export async function openSpool() {
  try {
    return { spool: new IdbSpool(await database()), durable: true };
  } catch {
    return { spool: new MemorySpool(), durable: false };
  }
}
