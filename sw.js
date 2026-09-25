// ============================================================================
// LINSORA Service Worker — v5 (PWA + Offline Seguro)
// Regras:
//  - NUNCA cachear Supabase / auth / APIs / dados do usuário (network-only).
//  - Apenas arquivos estáticos same-origin entram em cache.
//  - Navegação: network-first -> index.html (cache) -> offline.html.
// ============================================================================

const CACHE_NAME = 'linsora-v5';

const ASSETS_TO_CACHE = [
  './index.html',
  './offline.html',
  './css/styles.css',
  './css/pwa-install.css',
  './css/responsive.css',
  './js/app.js',
  './js/pwa-install.js',
  './js/store.js',
  './js/supabase-client.js',
  './js/components.js',
  './js/utils.js',
  './js/charts.js',
  './js/notifications.js',
  './js/logger.js',
  './js/voice-recognition.js',
  './js/voice-assistant-ui.js',
  './js/ai-transaction-parser.js',
  './js/strategic-advisor.js',
  './js/lib/supabase.min.js',
  './js/lib/chart.min.js',
  './js/lib/capacitor-preferences.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon-180.png'
];

/**
 * URLs que NUNCA devem passar pelo cache (dados, auth, APIs).
 * Supabase REST/Auth/Storage/Realtime passam por hosts *.supabase.co,
 * mas a checagem por substring também protege custom domains.
 */
function isBypassedUrl(url) {
  const u = url.toLowerCase();
  return (
    u.includes('supabase') ||
    u.includes('/auth/') ||
    u.includes('/rest/') ||
    u.includes('/storage/') ||
    u.includes('/realtime/') ||
    u.includes('/functions/')
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((name) => {
            // Remove apenas caches antigos DO LINSORA; preserva outros apps/SWs.
            if (name.startsWith('linsora-') && name !== CACHE_NAME) {
              return caches.delete(name);
            }
            return Promise.resolve(false);
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // 1. Métodos de escrita e qualquer chamada de dados: rede pura, sem interceptar.
  if (request.method !== 'GET') return;

  const requestUrl = new URL(request.url);

  // 2. Terceiros (CDN, fontes, avatares) e Supabase: nunca cachear.
  if (requestUrl.origin !== self.location.origin) return;
  if (isBypassedUrl(request.url)) return;

  // 3. Navegações da SPA: rede primeiro para nunca prender o usuário
  //    em login/sessão antigos; fallback seguro sem loops.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          return networkResponse;
        })
        .catch(async () => {
          const cachedIndex = await caches.match('./index.html');
          if (cachedIndex) return cachedIndex;
          const offlinePage = await caches.match('./offline.html');
          if (offlinePage) return offlinePage;
          return Response.error();
        })
    );
    return;
  }

  // 4. Estáticos same-origin: stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const networkUpdate = fetch(request)
        .then((networkResponse) => {
          // Cacheia apenas respostas OK e same-origin (type "basic").
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            networkResponse.type === 'basic'
          ) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, copy);
            }).catch(() => { /* quota ou erro: ignora, rede já respondeu */ });
          }
          return networkResponse;
        })
        .catch(() => null);

      if (cachedResponse) return cachedResponse;
      return networkUpdate.then((netRes) => {
        if (netRes) return netRes;
        return Response.error();
      });
    })
  );
});
