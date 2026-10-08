import assert from 'node:assert/strict';

/**
 * 使用正式頁面與隔離 IndexedDB，驗證跨分頁恢復、實際漢字模式與有限寫入。
 */
export async function run({ page, context, origin }) {
  await page.goto(origin + '/ja/quiz.html');
  await page.locator('[data-set="kanjiMode"][data-value="kana"]').click();
  await page.locator('[data-set="source"][data-value="scene"]').click();
  await page.locator('[data-start]').click();
  await page.locator('[data-opt]').first().waitFor();
  await page.evaluate(async () => {
    const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
    const store = getLearningStore();
    const original = store.legacyView;
    window.scopeReadCount = 0;
    store.legacyView = (...args) => { window.scopeReadCount++; return original(...args); };
  });
  await page.locator('[data-opt]').first().click();
  await page.waitForFunction(() => !document.querySelector('[data-next]').disabled);
  const info = await page.evaluate(async () => {
    const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
    const { rows } = await getLearningStore().read(['reviewEvents']);
    return { mode: Object.values(rows.reviewEvents)[0].assistance.kanjiMode, reads: window.scopeReadCount };
  });
  assert.equal(info.mode, 'show', '情境題實際為漢字，不記隱藏的 kana 偏好');
  assert.equal(info.reads, 0, '每題保存不重讀完整 scope');
  await page.locator('[data-quit]').click();
  await page.locator('[data-set="source"][data-value="words"]').click();
  await page.locator('[data-start]').click();
  await page.locator('[data-opt]').first().waitFor();
  const other = await context.newPage();
  await other.goto(origin + '/ja/quiz.html');
  await other.locator('[data-resume-quiz]').first().click();
  await other.locator('[data-opt]').first().waitFor();
  await page.locator('[data-opt]').first().click();
  await page.waitForFunction(() => !document.querySelector('[data-next]').disabled);
  await other.locator('[data-opt]').nth(1).click();
  await other.locator('[data-question-reload]').waitFor();
  assert.equal(await other.locator('[data-question-retry]').count(), 0, '永久衝突不提供無效重送');
  for (const width of [320, 375, 1280]) {
    await other.setViewportSize({ width, height: 800 });
    assert.equal(await other.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `同步入口 ${width}px 無水平溢出`);
    const rect = await other.locator('[data-question-reload]').boundingBox();
    assert.ok(rect.height >= 44 && rect.width >= 44, '同步按鈕可觸控');
  }
  await other.locator('[data-question-reload]').click();
  await other.locator('[data-resume-quiz]').first().click();
  await other.locator('[data-opt]').first().waitFor();
  assert.match(await other.locator('.progress-text').innerText(), /第 2/, '衝突後可同步續答');
  await page.evaluate(async () => {
    const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
    await getLearningStore().clearAll();
  });
  await other.locator('[data-opt]').first().click();
  await other.locator('[data-question-reload]').waitFor();
  assert.equal(await other.locator('[data-question-retry]').count(), 0, '清除後舊世代不提供無效重送');
  await other.locator('[data-question-reload]').click();
  await other.locator('[data-start]').waitFor();
  assert.equal(await other.locator('[data-resume-quiz]').count(), 0, '同步後已清除的局不復活');
  assert.equal(await other.evaluate(async () => {
    const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
    const { rows } = await getLearningStore().read(['reviewEvents', 'sessions']);
    return Object.keys(rows.reviewEvents).length + Object.keys(rows.sessions).length;
  }), 0);
  await other.close();
}
