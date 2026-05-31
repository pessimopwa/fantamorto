// ===================================================
// SERVICE WORKER — Portale Vetrina Giovanni Dev
// Strategia: Cache-First per risorse statiche
// ===================================================

const CACHE_NAME   = 'giovanni-dev-v1';
const ASSETS_CACHE = [
  '/',
  '/index.html',
  '/manifest.json'
];

// ===== INSTALL: metti in cache le risorse essenziali =====
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Pre-caching assets');
      return cache.addAll(ASSETS_CACHE);
    })
  );
  self.skipWaiting();
});

// ===== ACTIVATE: rimuovi cache vecchie =====
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Eliminazione cache obsoleta:', key);
            return caches.delete(key);
          })
      )
    )
  );
  self.clients.claim();
});

// ===== FETCH: Cache-First con fallback alla rete =====
self.addEventListener('fetch', event => {
  // Ignora richieste non-GET e richieste a domini esterni
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      // Non in cache: vai in rete e aggiorna la cache
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200) return response;

        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      });
    })
  );
});
