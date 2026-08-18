// Tombstone service worker for the domain root.
//
// blaster used to be served from https://nimblerendition.com/ and registered a
// Workbox service worker at this exact URL, with scope "/" and a navigation
// fallback to the old root index.html. Every browser that ever loaded the game
// still has that worker installed, and it will happily keep serving the cached
// game for the whole domain — including this landing page and the other apps.
//
// A service worker only ever updates by re-fetching its own script, so the fix
// has to live here: this file replaces the old one, drops everything it cached,
// and unregisters itself. After one visit, the domain root is plain HTTP again.
//
// Keep this file at the root — and out of any long-lived cache — until it is
// safe to assume every returning visitor has picked it up.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();

      // Reload any open tab so it stops being controlled by a worker that no
      // longer exists and re-fetches the real page from the network.
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) {
        client.navigate(client.url);
      }
    })(),
  );
});

// Nothing is cached and nothing is intercepted — every request goes to the
// network for as long as this worker is still controlling a page.
self.addEventListener("fetch", () => {});
