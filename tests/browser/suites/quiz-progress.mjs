import assert from 'node:assert/strict';

/**
 * 正式自由測驗的逐題保存、半局續答、失敗重試與結果不重算，僅使用隔離假資料。
 */
export async function run({ page, origin }) {
  const state = () => page.evaluate(async () => {
    const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
    const { rows } = await getLearningStore().read(['sessions', 'reviewEvents', 'stats']);
    return { sessions: Object.values(rows.sessions), events: Object.values(rows.reviewEvents), stats: rows.stats };
  });
  await page.goto(origin + '/ja/quiz.html');
  await page.locator('[data-start]').waitFor();
  await page.locator('[data-start]').click();
  await page.locator('[data-opt]').first().click();
  await page.waitForFunction(() => document.querySelector('[data-question-save]')?.textContent.includes('已保存'));
  const first = await state();
  assert.equal(first.stats['ja:words'].answered, 1);
  assert.equal(first.stats['ja:words'].sessions, 0, 'D24 半局不加局數');
  const prompt = first.sessions[0].questionSnapshots[first.sessions[0].orderedEntryIds[1]].prompt;
  await page.reload();
  await page.locator('[data-resume-quiz]').first().click();
  await page.locator('[data-opt]').first().waitFor();
  assert.equal(await page.locator('.prompt').innerText(), prompt, 'D11 同題序續答');
  await page.evaluate(async () => {
    const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
    const repo = getLearningStore().repository;
    const original = repo.commit;
    let once = true;
    repo.commit = (...args) => {
      if (once && args[0].operationId.startsWith('quiz-review-')) {
        once = false;
        return Promise.reject(Object.assign(new Error('fixture abort'), { code: 'STORAGE_ABORTED' }));
      }
      return original(...args);
    };
  });
  await page.locator('[data-opt]').first().click();
  await page.locator('[data-question-retry]').waitFor();
  assert.equal(await page.locator('[data-next]').isDisabled(), true);
  assert.equal((await state()).events.length, 1, 'D12 未部分寫入');
  await page.locator('[data-question-retry]').click();
  await page.waitForFunction(() => !document.querySelector('[data-next]').disabled);
  await page.locator('[data-next]').click();
  for (let i = 2; i < 10; i++) {
    await page.locator('[data-opt]').first().click();
    await page.waitForFunction(() => !document.querySelector('[data-next]').disabled);
    await page.locator('[data-next]').click();
  }
  await page.locator('.score').waitFor();
  const done = await state();
  assert.equal(done.stats['ja:words'].answered, 10);
  assert.equal(done.stats['ja:words'].sessions, 1);
  assert.equal(done.events.length, 10);
  await page.locator('[data-again]').click();
  await page.locator('[data-start]').waitFor();
  assert.equal((await state()).stats['ja:words'].sessions, 1);
  assert.equal(await page.locator('[data-resume-quiz]').count(), 0);
  await page.locator('[data-set="source"][data-value="cloze"]').click();
  await page.locator('[data-start]').click();
  await page.locator('[data-blank]').first().waitFor();
  const blankCount = await page.locator('[data-blank]').count();
  for (let i = 0; i < blankCount; i++) {
    await page.locator(`[data-word="${i}"]`).click();
    await page.locator(`[data-blank="${i}"]`).click();
  }
  await page.locator('[data-submit]').click();
  await page.waitForFunction(() => !document.querySelector('[data-next]').disabled);
  assert.equal((await state()).stats['ja:cloze'].answered, 1, '填空逐題入帳');
  await page.reload();
  await page.locator('[data-resume-quiz]').first().click();
  await page.locator('[data-blank]').first().waitFor();
  assert.match(await page.locator('.progress-text').innerText(), /第 2/);
  await page.locator('[data-quit]').click();
  await page.locator('[data-start]').waitFor();
  for (const source of ['scene', 'reading']) {
    await page.locator(`[data-set="source"][data-value="${source}"]`).click();
    await page.locator('[data-start]').click();
    await page.locator('[data-opt]').first().click();
    await page.waitForFunction(() => !document.querySelector('[data-next]').disabled);
    assert.equal((await state()).stats[`ja:${source}`].answered, 1);
    await page.locator('[data-quit]').click();
    await page.locator('[data-start]').waitFor();
  }
  await page.goto(origin + '/en/quiz.html');
  await page.locator('[data-start]').click();
  await page.locator('[data-opt]').first().click();
  await page.waitForFunction(() => !document.querySelector('[data-next]').disabled);
  assert.equal((await state()).stats['en:words'].answered, 1);
  for (const width of [320, 375, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `D23 ${width}px`);
  }
  assert.equal(await page.evaluate(async () => {
    const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
    const { validateLearning } = await import('/assets/js/core/learning-schema.js');
    return validateLearning((await getLearningStore().exportBackup()).learning).ok;
  }), true, 'D20 英日文、各題型與半局完整可攜');
}
