// ══════════════════════════════════════════════════════════════
// FANTAMORTO — Service Worker (PWA)
// Strategia: Cache First per asset statici, Network First per API
// ══════════════════════════════════════════════════════════════

// ⚠️  VERSIONING CENTRALIZZATO: ogni volta che vuoi forzare l'aggiornamento
//     su tutti i dispositivi, incrementa questo numero (v1 → v2 → v3 …).
//     Il browser rileva la modifica, scarica i nuovi file e app.js
//     gestisce il reload automatico (silenzioso in background, banner in foreground).
const CACHE_NAME = 'fantamorto-v2';
const STATIC_ASSETS = [
    './',
    './index.html',
    './app.css',
    './app.js',
    './manifest.json'
];

// Installa il SW e pre-cacha gli asset statici
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
    );
    self.skipWaiting();
});

// Pulisce le cache vecchie all'attivazione
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Intercetta le richieste:
// - Supabase / Wikipedia / Wikidata → sempre da rete (dati live)
// - Tutto il resto → cache first con fallback rete
self.addEventListener('fetch', event => {
    const url = event.request.url;

    // Richieste alle API esterne: sempre network
    if (url.includes('supabase.co') || url.includes('wikipedia.org') || url.includes('wikidata.org')) {
        event.respondWith(fetch(event.request));
        return;
    }

    // Asset statici: cache first
    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;
            return fetch(event.request).then(response => {
                // Cacha solo risposte valide di tipo basic
                if (!response || response.status !== 200 || response.type !== 'basic') return response;
                const toCache = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, toCache));
                return response;
            });
        })
    );
});
