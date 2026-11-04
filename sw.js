const CACHE = 'uni-cockpit-v2.2.0-flat';
const FILES = ['./', './index.html', './styles.css', './app.js', './model.js', './deadline-alerts.js', './storage.js', './sync.js', './cloud-store.js', './cloud-session.js', './firebase-client.js', './firebase-sdk.js', './firebase-config.js', './firebase-transport.js', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
  // Updates wait until existing app windows close to avoid mixing code versions.
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('uni-cockpit-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).catch(error => {
    if (event.request.mode === 'navigate') return caches.match(new URL('./index.html', self.location.href));
    throw error;
  })));
});
