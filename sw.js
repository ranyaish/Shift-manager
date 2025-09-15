self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open('pnl-cache-v1').then((c) => c.addAll(['./', './index.html']))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((r) =>
      r ||
      fetch(e.request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open('pnl-cache-v1').then((c) => c.put(e.request, copy));
          return resp;
        })
        .catch(() => caches.match('./index.html'))
    )
  );
});
