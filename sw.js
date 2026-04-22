const CACHE = 'dienstplan-generator-cache-v2';
const ASSETS = ['./', './index.html', './styles.css', './app.js', './manifest.json', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (url.pathname.endsWith('/app.js') || url.pathname.endsWith('/styles.css') || url.pathname.endsWith('/index.html')) {
    event.respondWith(
      fetch(event.request)
        .then(networkRes => {
          const copy = networkRes.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy));
          return networkRes;
        })
        .catch(() => caches.match(event.request).then(res => res || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(res => res || fetch(event.request).then(networkRes => {
      const copy = networkRes.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy));
      return networkRes;
    }).catch(() => caches.match('./index.html')))
  );
});
