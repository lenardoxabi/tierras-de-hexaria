/* Tierras de Hexaria: service worker. Guarda la página, el manifiesto, los iconos, las librerías y las fuentes para jugar sin conexión. */
const VERSION = 'hexaria-v50';
const SHELL = ['./', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
const CDN = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.allSettled(SHELL.map(u => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  // La página y los archivos propios: primero la red (para recibir versiones nuevas), si falla la copia guardada
  if (req.mode === 'navigate' || url.origin === self.location.origin) {
    e.respondWith(fetch(req).then(r => { if (r && r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req.mode === 'navigate' ? './' : req, copy)); } return r; })
      .catch(() => caches.match(req.mode === 'navigate' ? './' : req)));
    return;
  }
  // Librerías y fuentes: lo guardado primero, y se actualiza en segundo plano
  if (CDN.includes(url.hostname)) {
    e.respondWith(caches.open(VERSION).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()); return r; }).catch(() => null);
      return hit || (await net) || Response.error();
    }));
  }
});
self.addEventListener('message', e => { if (e.data === 'skip') self.skipWaiting(); });
// Al tocar la notificación de la partida se vuelve a la pestaña del juego
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const c = list.find(x => 'focus' in x); if (c) return c.focus(); return self.clients.openWindow('./');
  }));
});
