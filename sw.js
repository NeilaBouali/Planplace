const CACHE = 'planplace-static-v3';
const ASSETS = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => {e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate', e => {e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin || u.pathname.endsWith('/config.js')) return;
  e.respondWith(fetch(e.request).then(response=>{if(response.ok && (u.pathname.endsWith('/') || ASSETS.filter(x=>x!=='./').some(x=>u.pathname.endsWith('/'+x.slice(2))))){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(e.request,copy));}return response;}).catch(()=>caches.match(e.request)));
});
