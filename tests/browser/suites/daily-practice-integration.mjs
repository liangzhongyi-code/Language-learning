import assert from 'node:assert/strict';

async function seed(page, origin, lang, mode, { custom = false, missing = false } = {}) {
  await page.goto(origin + '/__harness__');
  await page.evaluate(async ({ lang, mode, custom, missing }) => {
    const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
    const { initializeItemState } = await import('/assets/js/core/scheduler.js');
    const { PRACTICE_MODES } = await import('/assets/js/core/practice-engine.js');
    const { practice } = await import(`/assets/js/data/${lang}/practice.js`);
    const { words } = await import(`/assets/js/data/${lang}/words.js`);
    const { setPref } = await import('/assets/js/ui/prefs.js');
    const ids = new Set(words.filter(word => word.level === 1).map(word => word.id));
    const item = practice.find(item => item.mode === mode && ids.has(item.sourceId));
    const { ability, direction } = PRACTICE_MODES[mode];
    const state = initializeItemState({ sourceId: item.sourceId, ability, direction, initialization: { kind: 'new' } });
    const store = getLearningStore();
    await store.clearAll();
    await store.commit({ stores: [], operationId: `seed-${lang}-${mode}`, build: () => [
      { store: 'itemStates', key: state.skillKey, value: state },
    ] });
    setPref(`daily.${lang}.level`, 1);
    setPref(`daily.${lang}.newLimit`, 0);
    window.dailyPracticeFixture = { calls: [], fail: false, providerCalls: 0, retryCalls: 0 };
    if (custom) {
      const original = store.repository.commit;
      store.repository.commit = async (...args) => {
        if (args[0].operationId.startsWith('submit-')) {
          dailyPracticeFixture.calls.push(args[0].operationId);
          if (dailyPracticeFixture.fail) throw Object.assign(new Error('private-save-detail'), { code: 'STORAGE_ABORTED' });
        }
        return original(...args);
      };
      const { initDailyPage } = await import('/assets/js/ui/daily-view.js');
      initDailyPage({ lang, words, practiceProvider: async () => { dailyPracticeFixture.providerCalls++; return missing ? [] : practice; },
        onDataRetry: () => { dailyPracticeFixture.retryCalls++; }, mount: document.querySelector('#app'), noticeHost: document.createElement('div') });
    }
  }, { lang, mode, custom, missing });
  if (!custom) await page.goto(`${origin}/${lang}/daily.html`);
  await page.locator('[data-continue]').click();
}

async function records(page) {
  return page.evaluate(async () => {
    const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
    return (await getLearningStore().read(['dailyPlans', 'sessions', 'itemStates', 'reviewEvents', 'stats'])).rows;
  });
}

async function answer(page, question) {
  if (question.answerKey.accepted) {
    await page.locator('[data-dp-input]').fill(question.answerKey.accepted[0]);
    await page.locator('[data-dp-submit]').click();
  } else if (question.options) await page.locator(`[data-dp-option="${question.answerKey.correctIndex}"]`).click();
  else {
    const remaining = [...question.fragments];
    let suffix = question.answerKey.answer;
    while (remaining.length) {
      const index = remaining.findIndex(piece => suffix.startsWith(piece.text));
      assert.notEqual(index, -1);
      const [piece] = remaining.splice(index, 1);
      suffix = suffix.slice(piece.text.length);
      await page.locator(`[data-dp-pick="${piece.instanceId}"]`).click();
    }
    await page.locator('[data-dp-submit]').click();
  }
}

export async function run({ page, origin }) {
  await page.addInitScript(() => {
    window.audioFixture = { current: null, finish(ok) {
      const utterance = this.current; this.current = null;
      const event = new Event(ok ? 'end' : 'error'); event.error = 'synthesis-failed'; utterance.dispatchEvent(event);
    } };
    window.SpeechSynthesisUtterance = class extends EventTarget { constructor(text) { super(); this.text = text; } };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [{ lang: 'ja-JP', localService: true }, { lang: 'en-US', localService: true }],
      addEventListener() {}, removeEventListener() {},
      speak(utterance) { audioFixture.current = utterance; },
      cancel() { if (audioFixture.current) audioFixture.finish(false); },
    } });
  });

  // 真 page-boot → lazy practiceProvider → daily service → renderer → IDB。
  for (const lang of ['ja', 'en']) for (const mode of ['typing', ...(lang === 'ja' ? ['kana'] : []), 'listening', 'dictation', 'tiles', 'pos']) {
    await seed(page, origin, lang, mode);
    await page.locator('.daily-practice-question').waitFor();
    let rows = await records(page);
    const plan = Object.values(rows.dailyPlans)[0];
    const entry = plan.orderedEntries[0];
    const q = entry.questionSnapshot;
    assert.equal(q.practiceMode, mode);
    assert.equal(await page.locator('[data-next]').isDisabled(), true);
    assert.equal(await page.locator('[data-dp-feedback]').count(), 0);
    if (mode === 'typing') {
      await page.reload();
      await page.locator('[data-continue]').click();
      await page.locator('.daily-practice-question').waitFor();
      assert.deepEqual(Object.values((await records(page)).dailyPlans)[0].orderedEntries[0].questionSnapshot, q, '重開沿用固定快照');
    }
    if (['listening', 'dictation'].includes(mode)) {
      const html = await page.locator('.daily-practice-question').innerHTML();
      assert.ok(!html.includes(q.speakText), '答前 DOM 不輸出朗讀答案');
      await page.locator('[data-dp-play]').click();
      await page.evaluate(() => audioFixture.finish(false));
      await page.waitForFunction(() => document.querySelector('.daily-practice-question')?.textContent.includes('播放未成功'));
      assert.equal(Object.keys((await records(page)).reviewEvents).length, 0, '播放失敗不計分');
      await page.locator('[data-dp-back]').click();
      await page.locator('[data-continue]').click();
      await page.locator('[data-dp-play]').click();
      await page.evaluate(() => audioFixture.finish(true));
      await page.waitForFunction(() => document.querySelector('.daily-practice-question')?.textContent.includes('播放完成'));
    }
    await answer(page, q);
    await page.locator('[data-dp-feedback]').waitFor();
    assert.match(await page.locator('[data-dp-feedback]').innerText(), /答對了/);
    assert.equal(await page.locator('[data-next]').isDisabled(), false);
    rows = await records(page);
    const event = Object.values(rows.reviewEvents)[0];
    assert.equal(Object.keys(rows.reviewEvents).length, 1);
    assert.equal(event.skillKey, entry.skillKey);
    assert.equal(event.assistance.context.ability, q.ability);
    assert.deepEqual(rows.stats[`${lang}:daily`], { answered: 1, correct: 1, sessions: 1 });
    await page.evaluate(async () => (await import('/assets/js/ui/platform/learning-store.js')).getLearningStore().exportBackup());
  }

  await seed(page, origin, 'ja', 'typing', { custom: true });
  await page.locator('[data-dp-input]').waitFor();
  const q = Object.values((await records(page)).dailyPlans)[0].orderedEntries[0].questionSnapshot;
  await page.evaluate(() => { dailyPracticeFixture.fail = true; });
  await answer(page, q);
  await page.locator('[data-dp-retry]').waitFor();
  assert.equal(await page.locator('[data-next]').isDisabled(), true);
  assert.equal(await page.locator('[data-dp-feedback]').count(), 0, '保存失敗不露正解');
  assert.equal(Object.keys((await records(page)).reviewEvents).length, 0);
  await page.evaluate(() => { dailyPracticeFixture.fail = false; });
  await page.locator('[data-dp-retry]').click();
  await page.locator('[data-dp-feedback]').waitFor();
  const attempts = await page.evaluate(() => dailyPracticeFixture.calls);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0], attempts[1], 'UI 保存重試沿用同 reviewId');

  await seed(page, origin, 'ja', 'typing', { custom: true, missing: true });
  await page.locator('[data-prepare-retry]').waitFor();
  assert.match(await page.locator('#app').innerText(), /尚無同級對應題型，排程保留未完成/);
  assert.equal(Object.keys((await records(page)).sessions).length, 0);

  // 真 dynamic import 網路故障後，透過 page-boot 的重新載入回復，而非同文件重試假 provider。
  await seed(page, origin, 'ja', 'typing', { custom: true });
  await page.locator('[data-dp-input]').waitFor();
  await page.evaluate(async () => {
    const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
    const store = getLearningStore();
    const { rows } = await store.read(['dailyPlans']);
    const plan = Object.values(rows.dailyPlans)[0];
    await store.commit({ stores: [], operationId: 'reset-unprepared-fixture', build: () => [
      { store: 'sessions', key: plan.sessionId, delete: true },
      { store: 'dailyPlans', key: plan.planId, value: { ...plan, sessionId: null,
        orderedEntries: plan.orderedEntries.map(entry => ({ ...entry, status: 'pending', questionSnapshot: null })) } },
    ] });
  });
  await page.route('**/assets/js/data/ja/practice.js', route => route.abort());
  await page.goto(origin + '/ja/daily.html');
  await page.locator('[data-continue]').click();
  await page.locator('[data-prepare-retry]').waitFor();
  assert.match(await page.locator('[data-prepare-retry]').innerText(), /重新載入頁面重試/);
  const unchanged = await records(page);
  assert.equal(Object.keys(unchanged.sessions).length, 0);
  assert.equal(Object.keys(unchanged.reviewEvents).length, 0);
  await page.unroute('**/assets/js/data/ja/practice.js');
  await page.locator('[data-prepare-retry]').click();
  await page.locator('[data-continue]').click();
  await page.locator('[data-dp-input]').waitFor();
  assert.equal(Object.values((await records(page)).dailyPlans)[0].planId, Object.values(unchanged.dailyPlans)[0].planId);
}
