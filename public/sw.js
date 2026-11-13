const PREFIX = 'noxaplus-pdf-desk-';
const CACHE = `${PREFIX}v1`;
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/maskable-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const index = new URL('index.html', scope);
  if (event.request.mode === 'navigate' && (url.pathname === scope.pathname || url.pathname === index.pathname)) {
    event.respondWith(fetch(event.request).then(response => {
      if (response.ok && response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'text/html') {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then(cache => cache.put(index.href, copy)));
      }
      return response;
    }).catch(() => caches.match(index.href)));
  } else event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
