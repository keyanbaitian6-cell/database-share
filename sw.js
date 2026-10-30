// 公開stageで内容由来の版と正確なファイルURLに置換する。Google通信は保存・中継しない。
const VERSION = 'a4b3837d3970';
const FILES = ["./index.html", "./android.html", "./app.mjs?v=a4b3837d3970", "./apple-touch-icon.png?v=a4b3837d3970", "./capture_health.mjs?v=a4b3837d3970", "./character_birthdays.json?v=a4b3837d3970", "./data.mjs?v=a4b3837d3970", "./event_history.mjs?v=a4b3837d3970", "./favicon.png?v=a4b3837d3970", "./icon-192.png?v=a4b3837d3970", "./icon-512.png?v=a4b3837d3970", "./manifest-android.json?v=a4b3837d3970", "./manifest.json?v=a4b3837d3970", "./net.mjs?v=a4b3837d3970", "./offline.mjs?v=a4b3837d3970", "./recommendations.mjs?v=a4b3837d3970", "./viewer_parts.mjs?v=a4b3837d3970"];
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
