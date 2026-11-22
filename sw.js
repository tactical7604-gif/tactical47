/* Offline support for 축구 분석 노트. The app opens without internet once it has been opened online. */
const VERSION = 'bb2ea41e';
const SHELL = 'fn-shell-' + VERSION;
const FONTS = 'fn-fonts';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './maskable-512.png', './apple-touch-icon.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('fn-shell-') && k !== SHELL).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  /* The page itself: newest version when online; the saved copy when offline or when the site answers with an error */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(cache => cache.put('./index.html', copy)); return res; }
          return caches.match('./index.html').then(hit => hit || res);
        })
        .catch(() => caches.match('./index.html').then(hit => hit || caches.match('./')))
    );
    return;
  }

  /* Betman odds file (the GitHub robot rewrites it every 30 minutes): always from the network */
  if (url.origin === self.location.origin && /betman\.json$/.test(url.pathname)) return;

  /* Icons and manifest: saved copy first */
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(cache => cache.put(req, copy)); }
        return res;
      }))
    );
    return;
  }

  /* Google Fonts: saved copy first, refreshed in the background */
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(FONTS).then(cache => cache.match(req).then(hit => {
        const fresh = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || fresh;
      }))
    );
  }
});
