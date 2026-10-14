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
export async function prepareOffline() {
  if (!('serviceWorker' in navigator)) return false;
  const registration = await navigator.serviceWorker.register('./sw.js', {scope: './', updateViaCache: 'none'});
  await navigator.serviceWorker.ready;
  if (registration.waiting) registration.waiting.postMessage('activate');
  return true;
}
