// Rosée — service worker : cache de l'interface + notifications push.
const CACHE = 'rosee-v5';
const SHELL = ['/', '/index.html', '/app.css', '/app.js', '/theme.js', '/manifest.webmanifest', '/fonts/manrope.woff2', '/icons/icon.svg', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Interface : réseau d'abord, cache en secours. API : toujours le réseau.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/cal/') || url.pathname.startsWith('/auth/') || url.pathname === '/push-action') return;
  if (url.pathname.startsWith('/photos/') || url.pathname.startsWith('/fonts/')) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    })));
    return;
  }
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then((hit) => hit || caches.match('/index.html'))));
});

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data && e.data.text() }; }
  const opts = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: data.tag || 'rosee',
    renotify: true,
    data: { url: data.url || '/', token: data.token || null, done: data.done || null },
  };
  // Boutons « Arrosée » / « Dans 3 h » (Android, Windows, macOS ; iOS ne les affiche pas)
  if (data.token && Array.isArray(data.actions)) opts.actions = data.actions.slice(0, 2);
  if (data.image) opts.image = data.image;
  e.waitUntil(self.registration.showNotification(data.title || 'Rosée', opts));
});

async function openApp(url) {
  const target = new URL(url || '/', location.origin).href;
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const w of wins) if (w.url.startsWith(location.origin)) { await w.focus(); return w.navigate ? w.navigate(target) : null; }
  return self.clients.openWindow(target);
}

async function runAction(n, action) {
  const { token, url, done } = n.data || {};
  try {
    const res = await fetch('/push-action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, action }) });
    if (!res.ok) throw new Error(String(res.status));
    // Petite confirmation qui remplace la notification, sans son ni vibration
    await self.registration.showNotification(action === 'water' ? (done || 'Arrosage enregistré') : 'Rappel reporté', {
      body: action === 'water' ? 'Merci ! Le prochain arrosage est recalculé.' : 'Rosée vous le rappellera dans 3 heures.',
      icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', tag: n.tag, silent: true, data: { url },
    });
    // Les fenêtres ouvertes se rafraîchissent
    for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage({ type: 'rosee-refresh' });
  } catch {
    // Jeton expiré ou serveur injoignable : on ouvre l'appli à la bonne plante
    await openApp(url);
  }
}

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  if ((e.action === 'water' || e.action === 'later') && e.notification.data?.token) {
    e.waitUntil(runAction(e.notification, e.action));
    return;
  }
  e.waitUntil(openApp(e.notification.data?.url));
});
