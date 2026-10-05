/* きょうのタスク Service Worker
   ネットにつながっていれば最新版を取得し、つながっていなければ保存済みのファイルで起動する */
// ▼ 改修してアップするたびに、app.js の APP_VERSION・version.json と同じ番号にそろえて上げる
const CACHE = 'kyou-task-v3.7.1';
const FILES = [
  './', './index.html', './style.css', './art.js', './app.js', './sync.js', './firebase-sdk.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
  './icons/favicon-32.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  // 1つ取れないファイルがあっても、入れ替えが止まらないように1つずつ保存する
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(FILES.map(f => c.add(new Request(f, { cache: 'reload' })).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.endsWith('/version.json')) return; // 最新版の確認はキャッシュを通さない
  e.respondWith(
    // ブラウザの一時保存（最大10分）を使わず、毎回GitHub Pagesに「変わった？」を確認する
    fetch(e.request.url, { cache: 'no-cache' })
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
