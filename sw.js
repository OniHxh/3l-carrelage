// Service worker : interface disponible hors connexion + photos et devis servis depuis l'appareil.
// À chaque mise à jour publiée, incrémenter CACHE.
const CACHE = '3l-v3';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/boot.js', 'js/app.js', 'js/core.js', 'js/store.js', 'js/ui.js', 'js/docs.js', 'js/local.js', 'js/cloud.js',
  'js/views/dashboard.js', 'js/views/chantiers.js', 'js/views/clients.js', 'js/views/planning.js',
  'js/views/equipe.js', 'js/views/ca.js', 'js/views/parametres.js', 'js/views/outils.js', 'js/views/accueil.js',
  'shared/calc.js', 'shared/permissions.js', 'shared/pdftext.js',
  'icons/logo.png', 'icons/logo-full.png', 'icons/icon-192.png', 'icons/favicon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Lecture d'un fichier (photo, PDF) dans la base de l'appareil
function readBlob(id) {
  return new Promise((resolve) => {
    const req = indexedDB.open('3l-local');
    req.onupgradeneeded = () => req.transaction.abort(); // base pas encore créée : ne pas la créer vide ici
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('blobs')) { db.close(); return resolve(null); }
      const g = db.transaction('blobs').objectStore('blobs').get(id);
      g.onsuccess = () => { db.close(); resolve(g.result || null); };
      g.onerror = () => { db.close(); resolve(null); };
    };
  });
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const m = url.pathname.match(/\/api\/blobs\/([\w-]+)$/);
  if (m) {
    e.respondWith(readBlob(m[1]).then((b) => b
      ? new Response(b.blob, { headers: { 'Content-Type': b.mime || b.blob.type, 'Cache-Control': 'no-store' } })
      : new Response('Fichier pas encore synchronisé sur cet appareil.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })));
    return;
  }
  // Interface : réseau d'abord (mises à jour immédiates), copie locale si hors ligne ou réseau lent
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const net = fetch(e.request).then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; });
    const fallback = async () => (await cache.match(e.request, { ignoreSearch: true })) || (e.request.mode === 'navigate' ? cache.match('index.html') : undefined);
    try {
      const r = await Promise.race([net, new Promise((res) => setTimeout(res, 2500)).then(fallback)]);
      return r || (await net);
    } catch {
      return (await fallback()) || Response.error();
    }
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = e.notification.data?.url || './#/';
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => {
    for (const c of list) { if ('focus' in c) { c.navigate(target); return c.focus(); } }
    return self.clients.openWindow(target);
  }));
});
