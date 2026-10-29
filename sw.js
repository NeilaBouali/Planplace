// Pas de cache des données de présence ou d'identité.
// Seuls les fichiers statiques publics sont mis en cache pour l'interface PWA.
const CACHE = 'seatplace-static-v12';
const ASSETS = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './seatmark.svg', './push-config.js'];
self.addEventListener('install', e => {e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate', e => {e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin || u.pathname.endsWith('/config.js')) return;
  e.respondWith(fetch(e.request).then(response=>{if(response.ok && (u.pathname.endsWith('/') || ASSETS.filter(x=>x!=='./').some(x=>u.pathname.endsWith('/'+x.slice(2))))){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(e.request,copy));}return response;}).catch(()=>caches.match(e.request)));
});

// Notifications persistantes, compatibles PWA iOS / Android.
self.addEventListener('push', (event) => {
 let payload = {};
 try { payload = event.data ? event.data.json() : {}; } catch (_) {}
 const date = /^\d{4}-\d{2}-\d{2}$/.test(payload.date || '') ? payload.date : '';
 event.waitUntil(self.registration.showNotification('SeatPlace · Votre statut de demain ✈️', {
   body: 'Vous n’avez pas renseigné votre statut pour demain. Bureau, télétravail ou absence ?',
   icon: './icon-192.png', badge: './icon-192.png',
   tag: 'seatplace-reminder-' + date,
   renotify: false,
   data: { url: new URL('./?rappel=' + encodeURIComponent(date), self.registration.scope).href }
 }));
});
self.addEventListener('notificationclick', (event) => {
 event.notification.close();
 const destination = event.notification.data?.url || new URL('./', self.registration.scope).href;
 event.waitUntil((async () => {
   const windows = await clients.matchAll({type:'window',includeUncontrolled:true});
   for (const client of windows) {
     if(new URL(client.url).origin === self.location.origin) {
       if('navigate' in client) await client.navigate(destination);
       if('focus' in client) return client.focus();
     }
   }
   return clients.openWindow(destination);
 })());
});
