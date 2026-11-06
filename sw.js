/* Course Walker service worker: offline app shell + offline map tiles */
const VERSION = 'v2';
const SHELL = 'cw-shell-' + VERSION;
const TILES = 'cw-tiles-v1';            // must match TILE_CACHE in index.html
const LEAFLET = [
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js'
];
const SHELL_URLS = ['./', 'index.html', ...LEAFLET];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL)
      .then(c => Promise.all(SHELL_URLS.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('cw-shell-') && k !== SHELL).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function tileResponse(req) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req.url, { ignoreVary: true });
  if (hit) return hit;
  try {
    let res;
    try {
      res = await fetch(req.url, { mode: 'cors' });
      if (!res.ok) throw new Error('bad status');
    } catch (err) {
      res = await fetch(req.url, { mode: 'no-cors' });
    }
    if (res && (res.ok || res.type === 'opaque')) cache.put(req.url, res.clone());
    return res;
  } catch (err) {
    return Response.error();
  }
}

async function networkFirst(req, fallbackKey) {
  const cache = await caches.open(SHELL);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);   // weak signal: fall back to cache quickly
    const res = await fetch(req, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    return (await cache.match(req, { ignoreSearch: true })) ||
           (await cache.match(fallbackKey)) ||
           Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req.url, { ignoreVary: true });
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) cache.put(req.url, res.clone());
    return res;
  } catch (err) {
    return Response.error();
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'tile.opentopomap.org') {
    e.respondWith(tileResponse(req));
  } else if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req, 'index.html'));
  } else if (LEAFLET.includes(req.url)) {
    e.respondWith(cacheFirst(req));
  } else if (url.origin === self.location.origin) {
    e.respondWith(networkFirst(req, req.url));
  }
});