const CACHE = 'apfelbuch-shell-v8';
const ASSETS = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil((async () => { const keys = await caches.keys(); await Promise.all(keys.filter(key => key.startsWith('apfelbuch-shell-') && key !== CACHE).map(key => caches.delete(key))); await self.clients.claim(); })()); });
self.addEventListener('fetch', event => { event.respondWith((async () => { const cache = await caches.open(CACHE); try { const response = await fetch(event.request); if (event.request.method === 'GET' && response.ok) cache.put(event.request, response.clone()).catch(() => {}); return response; } catch (err) { const cached = await cache.match(event.request); if (cached) return cached; throw err; } })()); });
