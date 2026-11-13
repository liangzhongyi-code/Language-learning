import assert from 'node:assert/strict';

/**
 * 用真 IndexedDB 讀寫確認測試在瀏覽器執行，並核對測試站的私有檔案隔離。
 * fixture 伺服器對白名單外的路徑回 403；本機 Worker（--server wrangler）只發布白名單，回 404（H02）。
 */
export async function run({ page, origin, intentionalFailure, serverKind = 'fixture' }) {
  assert.equal(await page.title(), '測試隔離頁');
  assert.equal(new URL(page.url()).origin, origin);
  const value = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('fixture-harness', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('items');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('items', 'readwrite');
      tx.objectStore('items').put({ value: 42 }, 'only-fixture');
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
    const result = await new Promise((resolve, reject) => {
      const request = db.transaction('items').objectStore('items').get('only-fixture');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return result.value;
  });
  assert.equal(value, 42);
  for (const path of ['/.git/config', '/package.json', '/node_modules/playwright/package.json', '/assets/../.idea/misc.xml']) {
    assert.equal(await page.evaluate(async (url) => (await fetch(url)).status, origin + path), serverKind === 'wrangler' ? 404 : 403, path);
  }
  if (intentionalFailure) {
    await page.evaluate(() => { throw new Error('F00 intentional failure'); });
  }
}
