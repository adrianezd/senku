'use strict';
/* Service worker: copia guardada para jugar sin conexión (responde con la copia y la actualiza por detrás). */
const CACHE = 'senku-v1';
const CORE = ["./","index.html","style.css","script.js","favicon.svg","manifest.json","icon-512.png"];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin && !/fonts.(googleapis|gstatic).com$/.test(url.hostname)) return;
  e.respondWith(caches.open(CACHE).then((c) => c.match(req, { ignoreSearch: url.origin === self.location.origin }).then((hit) => {
    const net = fetch(req).then((r) => { if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  })));
});
