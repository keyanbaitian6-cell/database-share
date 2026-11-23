// 接続先ごとにイベントと共有の印を保持する。台の履歴はviewer_partsのIndexedDBに保存する。
async function state(id, value) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('database-share-offline', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('metadata');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('metadata', value ? 'readwrite' : 'readonly');
      const op = value ? tx.objectStore('metadata').put(value, id) : tx.objectStore('metadata').get(id);
      tx.oncomplete = () => { db.close(); resolve(value || op.result || {}); };
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}
export const readOfflineMetadata = id => state(id);
export const saveOfflineMetadata = (id, value) => state(id, value);

const refreshKey = id => `database-share-refresh:${id}`;
const REFRESH_HOLD_MS = 6 * 60 * 60 * 1000;

// 更新を完了したページだけが自分の印を消す。別タブから始めた更新の印は残す。
export function beginShareRefresh(id) {
  const key = refreshKey(id);
  const mark = JSON.stringify({started: Date.now(), token: Math.random()});
  try { localStorage.setItem(key, mark); }
  catch { /* 保存できなくても更新は続ける。 */ }
  return () => {
    try { if (localStorage.getItem(key) === mark) localStorage.removeItem(key); }
    catch { /* 保存できなくても表示は続ける。 */ }
  };
}

export function shareRefreshHeld(id) {
  try {
    const {started} = JSON.parse(localStorage.getItem(refreshKey(id)) ?? '{}') ?? {};
    if (!Number.isFinite(started)) return false;
    const elapsed = Date.now() - started;
    // 閲覧ページと同じく開始時刻から6時間。時計が大きく戻っていたら止め続けない。
    return elapsed < REFRESH_HOLD_MS && elapsed > -REFRESH_HOLD_MS;
  } catch { return false; }
}

export async function prepareOffline() {
  if (!('serviceWorker' in navigator)) return false;
  const registration = await navigator.serviceWorker.register('./sw.js', {scope: './', updateViaCache: 'none'});
  await navigator.serviceWorker.ready;
  if (registration.waiting) registration.waiting.postMessage('activate');
  return true;
}
