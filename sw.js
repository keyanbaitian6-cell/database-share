// 公開stageで内容由来の版と正確なファイルURLに置換する。Google通信は保存・中継しない。
const VERSION = 'cf2777682571';
const FILES = ["./index.html", "./android.html", "./app.mjs?v=cf2777682571", "./apple-touch-icon.png?v=cf2777682571", "./capture_health.mjs?v=cf2777682571", "./character_birthdays.json?v=cf2777682571", "./daily_learning.mjs?v=cf2777682571", "./data.mjs?v=cf2777682571", "./event_history.mjs?v=cf2777682571", "./favicon.png?v=cf2777682571", "./icon-192.png?v=cf2777682571", "./icon-512.png?v=cf2777682571", "./manifest-android.json?v=cf2777682571", "./manifest.json?v=cf2777682571", "./net.mjs?v=cf2777682571", "./offline.mjs?v=cf2777682571", "./recommendations.mjs?v=cf2777682571", "./viewer_parts.mjs?v=cf2777682571"];
const PREFIX = 'database-share-shell-' + new URL(self.registration.scope).pathname + '-';
const CACHE = PREFIX + VERSION;
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      for (const file of FILES) {
        const response = await fetch(new Request(file, {cache: 'reload'}));
        if (!response.ok) throw new Error('オフライン用ファイルを取得できませんでした。');
        if (['./index.html', './android.html'].includes(file) && VERSION !== 'development' && !(await response.clone().text()).includes('./app.mjs?v=' + VERSION)) {
          throw new Error('公開ファイルの版が一致しません。次回再試行します。');
        }
        await cache.put(file, response);
      }
    } catch (error) { await caches.delete(CACHE); throw error; }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE)
    .map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', event => { if (event.data === 'activate') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url), scope = new URL(self.registration.scope);
  if (event.request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try { const response = await fetch(event.request); if (response.ok) return response; } catch { /* 保存済みで起動する */ }
      const page = url.pathname.endsWith('/android.html') ? './android.html' : './index.html';
      return (await caches.open(CACHE)).match(new URL(page, scope).href);
    })());
  } else {
    const file = FILES.find(file => {
      const saved = new URL(file, scope);
      return saved.pathname === url.pathname && (!url.search || saved.search === url.search);
    });
    if (file) event.respondWith(caches.open(CACHE).then(async cache =>
      (await cache.match(new URL(file, scope).href)) || fetch(event.request)));
  }
});
