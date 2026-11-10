// Replaces the service worker that /glide-reach/ installed before the page moved to /glide-path/. A browser that still
// has the old one fetches this on its next update check: it takes over, unregisters itself and sends any open tab to
// the new address. It deletes no caches: the saved terrain (glide-terrain-saved, glide-terrain-runtime) is shared with
// /glide-path/, and that page's own service worker clears the old glide-shell-* copy.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    await self.registration.unregister();
    for (const c of await self.clients.matchAll({ type: 'window' })) {
      const u = new URL(c.url);
      c.navigate(u.origin + '/glide-path/' + u.search + u.hash).catch(() => {});
    }
  })());
});
