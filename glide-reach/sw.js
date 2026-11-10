// Service worker for /glide-reach/: keeps the page and the terrain it has seen, so it runs with no signal.
//   - the page itself (this folder): network first so updates land, the cached copy when offline
//   - Terrarium terrain tiles: from a saved area or the recent-tile cache first, else the network (then kept)
//   - everything else (OpenStreetMap, OpenTopoMap) is left to the browser: their tile policies don't allow
//     offline storage, so offline the page switches to the shaded-terrain map drawn from the saved terrain.
// Bump VERSION when the list of SHELL files changes.
const VERSION = 'v3';
const SHELL = 'glide-shell-' + VERSION;
const SAVED = 'glide-terrain-saved';     // written by the page's "Save this area"; only the page deletes from it
const RUNTIME = 'glide-terrain-runtime'; // tiles fetched while browsing, capped
const RUNTIME_MAX = 600;                 // about 30–60 MB of terrain
const SHELL_FILES = [
  './', 'glide.css', 'glide-app.js', 'glide-core.js', 'glide-worker.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'lib/leaflet/leaflet.js', 'lib/leaflet/leaflet.css',
  'lib/leaflet/images/marker-icon.png', 'lib/leaflet/images/marker-icon-2x.png', 'lib/leaflet/images/marker-shadow.png',
  'lib/leaflet/images/layers.png', 'lib/leaflet/images/layers-2x.png'
];
const TERRAIN = /^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\/terrarium\//;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('glide-shell-') && k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (TERRAIN.test(req.url)) { e.respondWith(terrain(req.url)); return; }
  const url = new URL(req.url);
  if (url.origin === location.origin && url.pathname.startsWith(new URL('./', location).pathname)) {
    e.respondWith(shell(req));
  }
});

async function terrain(url) {
  const hit = (await (await caches.open(SAVED)).match(url)) || (await (await caches.open(RUNTIME)).match(url));
  if (hit) return hit;
  const res = await fetch(url, { mode: 'cors' });
  if (res.ok) {
    const c = await caches.open(RUNTIME);
    await c.put(url, res.clone());
    trim(c);
  }
  return res;
}

let trimming = false;
async function trim(c) {
  if (trimming) return; trimming = true;
  try {
    const keys = await c.keys();
    for (let i = 0; i < keys.length - RUNTIME_MAX; i++) await c.delete(keys[i]); // oldest first
  } finally { trimming = false; }
}

async function shell(req) {
  const c = await caches.open(SHELL);
  const key = req.mode === 'navigate' ? './' : req;
  const cached = await c.match(key, { ignoreSearch: true });
  const net = fetch(req).then(res => { if (res.ok) c.put(key, res.clone()); return res; });
  if (!cached) return net;
  // Weak signal at the field: wait at most 3 s for the network when a copy is on hand.
  return Promise.race([net.catch(() => cached), new Promise(r => setTimeout(() => r(cached), 3000))]);
}
