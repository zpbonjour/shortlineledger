/* Monopoly Banker service worker.
   Keeps the app shell (the page, manifest and icons) available offline: it is served from cache immediately
   and refreshed in the background. When the refreshed copy differs from the cached one, open pages are told
   so they can offer a reload. Google Fonts are cached on first use so the offline page still looks right.
   Bump VERSION to force a fresh precache after a deploy that must reach every device immediately. */
const VERSION = '2026-09-10a';
const SHELL_CACHE = 'mb-shell-' + VERSION;
const FONT_CACHE = 'mb-fonts-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(SHELL.map(async (path) => {
      try {
        const res = await fetch(new Request(path, { cache: 'no-cache' }));
        if (res.ok) await cache.put(path, res);
      } catch (e) { /* offline during install: the shell fills in on the next online visit */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== FONT_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') { event.respondWith(shell(event, '/', true)); return; }
    if (SHELL.includes(url.pathname)) { event.respondWith(shell(event, url.pathname, false)); return; }
    return; // sw.js and anything else go straight to the network
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(req, FONT_CACHE));
  }
});

/* Stale-while-revalidate for the shell. */
async function shell(event, path, notify) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(path);
  const cachedForCompare = cached ? cached.clone() : null;
  const refresh = (async () => {
    try {
      const res = await fetch(new Request(path, { cache: 'no-cache' }));
      if (!res || !res.ok) return null;
      if (cachedForCompare && notify && await differs(cachedForCompare, res.clone())) notifyClients();
      await cache.put(path, res.clone());
      return res;
    } catch (e) { return null; }
  })();
  if (cached) { event.waitUntil(refresh); return cached; }
  const fresh = await refresh;
  return fresh || offlineResponse();
}

async function differs(a, b) {
  const ea = a.headers.get('ETag'), eb = b.headers.get('ETag');
  if (ea && eb) return ea !== eb;
  const [ta, tb] = await Promise.all([a.text(), b.text()]);
  return ta !== tb;
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) await cache.put(req, res.clone());
    return res;
  } catch (e) {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

async function notifyClients() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const c of clients) c.postMessage({ type: 'app-updated' });
}

function offlineResponse() {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Monopoly Banker</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#EDF2EA;color:#17211A;font:16px/1.5 system-ui,sans-serif;padding:24px;text-align:center}
@media(prefers-color-scheme:dark){body{background:#111713;color:#E6ECE7}}h1{font-size:22px;margin:0 0 8px}p{margin:0;max-width:34ch}</style></head>
<body><div><h1>You're offline</h1><p>The banker hasn't been saved on this device yet. Open it once with a connection and it will work offline from then on.</p></div></body></html>`,
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
