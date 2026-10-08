import assert from 'node:assert/strict';

/**
 * 真 IndexedDB 查詢與頁面呈現；僅在隔離 context 移除 ES2022 API／注入一次讀取失敗。
 * 不以 memory repository 代替相容性證據，也不宣稱等同所有舊版瀏覽器實機。
 */
export async function run({ page, origin }) {
  const failures = [];
  const check = async (name, work) => {
    try { await work(); console.log('  PASS ' + name); }
    catch (error) { failures.push(name + ': ' + error.message); }
  };
  await check('未知錯誤與原型名稱不洩漏，已知錯誤仍有固定說明', async () => {
    const messages = await page.evaluate(async () => {
      const { storageMessage } = await import('/assets/js/ui/platform/learning-store.js');
      return [new Error('private-backup-sentinel'), { code: 'toString', message: 'private' },
        { code: '__proto__' }, { code: 'constructor' }, { code: 'UNRECOGNIZED', message: '<img src=x>' }, null,
        { code: 'STORAGE_QUOTA', message: 'private' }].map(storageMessage);
    });
    for (const message of messages.slice(0, -1)) assert.equal(message, '紀錄保存未完成，原資料保持不變；請重試。');
    assert.equal(messages.at(-1), '裝置空間不足，這次沒有保存，請先匯出備份。');
  });

  await check('統計頁的未知儲存錯誤不插入原始 HTML', async () => {
    await page.goto(origin + '/__harness__');
    const result = await page.evaluate(async () => {
      const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
      const { renderLangStats } = await import('/assets/js/ui/stats-view.js');
      const store = getLearningStore();
      const before = await store.exportBackup();
      const original = store.legacyView;
      const mount = document.createElement('section');
      document.body.appendChild(mount);
      store.legacyView = async () => { throw new Error('<img data-private-sentinel src="bad">private-backup-sentinel'); };
      try {
        renderLangStats(mount, 'en');
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('沒有顯示讀取錯誤')); }, 2000);
          const observer = new MutationObserver(() => {
            if (mount.querySelector('[role="alert"]')) { clearTimeout(timeout); observer.disconnect(); resolve(); }
          });
          observer.observe(mount, { childList: true, subtree: true });
        });
        return { text: mount.textContent, leakedNode: !!mount.querySelector('[data-private-sentinel]'),
          before: before.learning, after: (await store.exportBackup()).learning };
      } finally { store.legacyView = original; }
    });
    assert.equal(result.leakedNode, false);
    assert.equal(result.text, '紀錄保存未完成，原資料保持不變；請重試。');
    assert.deepEqual(result.after, result.before, '錯誤呈現不更動真 IndexedDB');
  });

  await check('缺少 Object.hasOwn 仍支援 scoped query 與統計頁', async () => {
    await page.goto(origin + '/__harness__');
    await page.evaluate(async () => {
      const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
      await getLearningStore().commit({ stores: ['stats'], operationId: 'compat-seed', build: () => [
        { store: 'stats', key: 'en:words', value: { answered: 2, correct: 1, sessions: 1 } },
      ] });
    });
    await page.addInitScript(() => { Object.hasOwn = undefined; });
    await page.goto(origin + '/en/index.html');
    const result = await page.evaluate(async () => {
      const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
      const store = getLearningStore();
      return { absent: typeof Object.hasOwn === 'undefined',
        bounded: await store.querySnapshot({ stats: { prefix: 'en:' } }),
        exact: await store.querySnapshot({ stats: { key: 'en:words' } }) };
    });
    assert.equal(result.absent, true);
    assert.equal(result.bounded.rows.stats['en:words'].answered, 2);
    assert.deepEqual(result.exact.rows.stats, result.bounded.rows.stats);
    await page.locator('#stats .big').first().waitFor();
    assert.match(await page.locator('#stats .stats').textContent(), /50%/);
    assert.equal(await page.locator('#stats [role="alert"]').count(), 0);
  });
  if (failures.length) throw new Error(failures.join('\n'));
}
