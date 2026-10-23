// IARI Live's service worker: the app's own files, network first, so a new
// version shows at once online and the app still opens offline (a booth's
// router without internet).  The stream itself (WebSocket) never passes here.
const CACHE = 'iari-live-v1';
const FILES = [
  './', 'index.html', 'live.css', 'app.js', 'proto.js', 'video.js', 'gl.js', 'charts.js', 'sources.js',
  'lab-view.jpg', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
  'vendor/uPlot.iife.min.js', 'vendor/uPlot.min.css',
  '../assets/fonts/fonts.css', '../assets/fonts/inter-latin.woff2', '../assets/fonts/outfit-latin.woff2',
  '../assets/logo-mark-256.png', '../assets/favicon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('iari-live-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true })));
});
