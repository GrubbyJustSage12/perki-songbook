// Perki Bodor service worker
// Bump CACHE_VERSION whenever you want to force every device to refresh its cached app files.
const CACHE_VERSION = 'v1';
const SHELL_CACHE = 'perki-shell-' + CACHE_VERSION;
const DATA_CACHE  = 'perki-data-' + CACHE_VERSION;

const SHELL_FILES = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

// Hosts whose responses are song/setlist data: network first, cached copy when offline
const DATA_HOSTS = ['raw.githubusercontent.com', 'api.npoint.io'];
// Google Fonts: cache after first load so the design stays intact offline
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== SHELL_CACHE && k !== DATA_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 1) Song list + setlist: try the network, fall back to the last saved copy.
  if (DATA_HOSTS.includes(url.hostname)) {
    event.respondWith(networkFirstData(req, url));
    return;
  }

  // 2) Fonts: use the cached copy, refresh it in the background.
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req, DATA_CACHE));
    return;
  }

  // 3) App files from this site: use the cached copy, refresh it in the background.
  if (url.origin === self.location.origin) {
    // Page navigations fall back to the cached index.html when offline
    if (req.mode === 'navigate') {
      event.respondWith(
        fetch(req).catch(() => caches.match('./index.html'))
      );
      return;
    }
    event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
  }
});

// The app adds ?t=timestamp to the setlist request to dodge browser caching,
// so we store data under the URL without its query string.
function dataKey(url) {
  return url.origin + url.pathname;
}

async function networkFirstData(req, url) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      cache.put(dataKey(url), fresh.clone());
    }
    return fresh;
  } catch (err) {
    const cached = await cache.match(dataKey(url));
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then(res => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  return cached || (await network) || Response.error();
}
