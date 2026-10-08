import assert from 'node:assert/strict';

/**
 * 正式頁面與隔離 IndexedDB 的上游契約回歸；不使用使用者 profile 或學習資料。
 * 僅在瀏覽器替換 Web Speech API、延遲／故障注入 service 邊界；出題、判題與交易仍走正式程式。
 * speech mock 驗證回呼與零事件契約，不代表真機語音驗證。
 */
async function instrument(context) {
  await context.addInitScript(() => {
    window.speechProbe = { utterances: [] };
    class Utterance extends EventTarget {
      constructor(text) { super(); this.text = text; }
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: Utterance });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [{ name: 'Test offline English', lang: 'en-US', localService: true }],
      addEventListener() {}, removeEventListener() {}, cancel() {},
      speak(utterance) { window.speechProbe.utterances.push(utterance); },
    } });
  });
  await context.route('**/assets/js/ui/platform/practice-service.js', async (route) => {
    const response = await route.fetch();
    const source = (await response.text()).replace('export function createPracticeService(', 'function basePracticeService(');
    await route.fulfill({ response, body: source + `
      export function createPracticeService(options) {
        const service = basePracticeService(options);
        const probe = window.practiceProbe = { calls: [], releases: [], skipCalls: [], skipReleases: [], hold: false, holdSkip: false, failBefore: false, failAfter: false };
        return { ...service,
          async start(args) { const result = await service.start(args); probe.round = result; return result; },
          async skip(args) {
            probe.skipCalls.push(structuredClone(args));
            if (probe.holdSkip) await new Promise(resolve => probe.skipReleases.push(resolve));
            if (probe.failSkip) { probe.failSkip = false; throw Object.assign(new Error('injected skip failure'), { code: 'STORAGE_ABORTED' }); }
            return service.skip(args);
          },
          async submit(args) {
            probe.calls.push(structuredClone(args));
            if (probe.hold) await new Promise(resolve => probe.releases.push(resolve));
            if (probe.failBefore) { probe.failBefore = false; throw Object.assign(new Error('injected quota'), { code: 'STORAGE_QUOTA' }); }
            const result = await service.submit(args);
            if (probe.failAfter) { probe.failAfter = false; throw Object.assign(new Error('injected lost response'), { code: 'STORAGE_UNAVAILABLE' }); }
            return result;
          }
        };
      }
    ` });
  });
}

const events = (page) => page.evaluate(async () => {
  const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
  return Object.values((await getLearningStore().read(['reviewEvents'])).rows.reviewEvents);
});
const saved = (page) => page.locator('[data-next]:not([disabled])').waitFor();
async function startPractice(page, origin, mode) {
  await page.goto(`${origin}/en/practice.html?mode=${mode}`);
  await page.locator('[data-start]:not([disabled])').click();
  await page.locator('.progress-text').waitFor();
  return page.evaluate(() => window.practiceProbe.round.questions[0]);
}
async function speechEvent(page, type, index = -1) {
  await page.evaluate(({ type, index }) => {
    const utterance = window.speechProbe.utterances.at(index);
    const event = new Event(type === 'end' ? 'end' : 'error');
    if (type !== 'end') Object.defineProperty(event, 'error', { value: type });
    utterance.dispatchEvent(event);
  }, { type, index });
}
async function settle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

export async function run({ context, origin }) {
  const failures = [];
  let passed = 0;
  async function check(name, runCase) {
    const isolated = await context.browser().newContext({ serviceWorkers: 'block' });
    const errors = [];
    isolated.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    await isolated.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    try {
      await instrument(isolated);
      const page = await isolated.newPage();
      page.setDefaultTimeout(5000);
      await runCase(page);
      assert.deepEqual(errors, [], '不得有未處理的頁面例外');
      console.log(`  PASS ${name}`);
      passed++;
    } catch (error) {
      const message = `${name}: ${error.message}${errors.length ? ' / pageerror: ' + errors.join('; ') : ''}`;
      failures.push(message);
      console.error(`  FAIL ${message}`);
    } finally { await isolated.close(); }
  }

  await check('quiz 冷載入題源保留 weak / due 範圍', async page => {
    for (const source of ['words', 'sentences']) {
      await page.goto(`${origin}/en/quiz.html?source=${source}`);
      await page.locator('[data-start]:not([disabled])').click();
      for (let index = 0; index < 4; index++) {
        await page.locator('[data-opt]:not([disabled])').first().waitFor();
        const wrong = await page.evaluate(async ({ source, index }) => {
          const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
          const sessions = Object.values((await getLearningStore().read(['sessions'])).rows.sessions);
          const session = sessions.filter(s => s.source === source).sort((a, b) => b.createdAt - a.createdAt)[0];
          const question = session.questionSnapshots[session.orderedEntryIds[index]];
          return (question.correctIndex + 1) % question.options.length;
        }, { source, index });
        await page.locator(`[data-opt="${wrong}"]`).click();
        await saved(page);
        if (index < 3) await page.locator('[data-next]').click();
      }
      await page.locator('[data-quit]').click();
    }
    const due = await page.evaluate(async () => {
      const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
      return Math.max(...Object.values((await getLearningStore().read(['itemStates'])).rows.itemStates).map(s => s.due));
    });
    await page.clock.setFixedTime(due + 1000);
    for (const scope of ['weak', 'due']) {
      await page.goto(origin + '/en/quiz.html');
      await page.locator('[data-start]:not([disabled])').waitFor();
      await page.locator(`[data-set="scope"][data-value="${scope}"]`).click();
      await page.locator('[data-set="source"][data-value="sentences"]').click();
      await page.locator('[data-start]:not([disabled])').waitFor();
      assert.equal(await page.locator(`[data-set="scope"][data-value="${scope}"]`).getAttribute('aria-pressed'), 'true', `${scope} 不被未載入的空池重設`);
    }
  });

  await check('practice 保存鎖住選項、快捷鍵與結束，結果對應原題', async page => {
    const question = await startPractice(page, origin, 'pos');
    await page.evaluate(() => { window.practiceProbe.hold = true; });
    await page.locator(`[data-opt="${question.answerKey.correctIndex}"]`).click();
    await page.waitForFunction(() => window.practiceProbe.releases.length === 1);
    assert.equal(await page.locator('[data-quit]').isDisabled(), true, '保存期間不可結束');
    assert.equal(await page.locator('[data-opt]:not([disabled])').count(), 0, '保存期間不可改選');
    await page.keyboard.press(String((question.answerKey.correctIndex + 1) % question.options.length + 1));
    await page.locator('[data-quit]').evaluate(el => el.click());
    await page.evaluate(() => window.practiceProbe.releases.shift()());
    await saved(page);
    assert.equal(await page.locator('.is-wrong').count(), 0, '回饋不混入保存中的改選');
    assert.match(await page.locator('.feedback').first().innerText(), /答對了/);
    const rows = await events(page);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].correct, true);
  });

  for (const mode of ['typing', 'tiles', 'reorder']) {
    await check(`practice ${mode} 保存鎖住所有可變輸入`, async page => {
      const question = await startPractice(page, origin, mode);
      if (mode === 'typing') await page.locator('[data-input]').fill(question.answerKey.accepted[0]);
      else await page.locator('[data-pick]').first().click();
      await page.evaluate(() => { window.practiceProbe.hold = true; });
      await page.locator('[data-submit]').click();
      await page.waitForFunction(() => window.practiceProbe.releases.length === 1);
      for (const selector of ['[data-input]', '[data-hint]', '[data-pick]', '[data-unpick]', '[data-clear-pick]', '[data-submit]', '[data-quit]']) {
        assert.equal(await page.locator(`${selector}:not([disabled])`).count(), 0, `${selector} 保存期間鎖住`);
      }
      await page.evaluate(() => window.practiceProbe.releases.shift()());
      await saved(page);
      assert.equal((await events(page)).length, 1);
    });
  }

  for (const failure of ['failBefore', 'failAfter']) {
    await check(`practice ${failure} 保留提交身份且重試回饋一致`, async page => {
      const question = await startPractice(page, origin, 'typing');
      const answer = question.answerKey.accepted[0];
      await page.locator('[data-input]').fill(answer);
      await page.evaluate(failure => {
        window.practiceProbe[failure] = true;
        window.staleHint = document.querySelector('[data-hint]');
      }, failure);
      await page.locator('[data-submit]').click();
      await page.locator('[data-retry]').waitFor();
      assert.equal((await events(page)).length, failure === 'failBefore' ? 0 : 1);
      assert.equal(await page.locator('.feedback').count(), 0, '尚未確認保存不能先判錯');
      assert.equal(await page.locator('[data-input]').inputValue(), answer, '保存失敗保留答案');
      assert.equal(await page.locator('[data-input]').isDisabled(), true, '重試固定原始答案');
      assert.doesNotMatch(await page.locator('#app').innerText(), /這題還沒有保存/, '回應遺失不能宣稱交易一定未寫入');
      await page.locator('[data-input]').evaluate(el => { el.value = 'changed'; el.dispatchEvent(new Event('input')); });
      await page.locator('[data-hint]').evaluate(el => el.click());
      await page.evaluate(() => window.staleHint.click());
      await page.locator('[data-retry]').click();
      await saved(page);
      const calls = await page.evaluate(() => window.practiceProbe.calls);
      assert.equal(calls.length, 2);
      assert.deepEqual(calls[1], calls[0], '重試 reviewId／round／index／response／hint 完全相同');
      assert.equal(await page.locator('[data-input]').inputValue(), answer);
      assert.match(await page.locator('.feedback').first().innerText(), /答對了/);
      assert.equal((await events(page)).length, 1, '重試不重複入帳');
    });
  }

  await check('practice 無效答案不入帳，解除輸入鎖且 IME 不誤送', async page => {
    const question = await startPractice(page, origin, 'typing');
    await page.locator('[data-submit]').click();
    await page.waitForFunction(() => document.querySelector('.backup-msg').textContent.includes('尚未輸入'));
    assert.equal((await events(page)).length, 0);
    assert.equal(await page.locator('[data-retry]').count(), 0);
    assert.equal(await page.locator('[data-input]').isDisabled(), false);
    await page.locator('[data-input]').fill(question.answerKey.accepted[0]);
    await page.locator('[data-input]').dispatchEvent('keydown', { key: 'Enter', isComposing: true });
    assert.equal((await events(page)).length, 0);
    await page.locator('[data-input]').press('Enter');
    await saved(page);
    assert.equal((await events(page)).length, 1);
  });

  for (const mode of ['listening', 'dictation']) {
    await check(`speech mock ${mode} 失敗零事件，成功重播後才能作答`, async page => {
      const question = await startPractice(page, origin, mode);
      await page.waitForFunction(() => window.speechProbe.utterances.length === 1);
      await speechEvent(page, 'synthesis-failed');
      await page.locator('[data-skip]').waitFor();
      await page.evaluate(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
        document.querySelector('[data-opt]')?.click();
        const input = document.querySelector('[data-input]');
        if (input) { input.value = 'wrong'; input.dispatchEvent(new Event('input')); }
        document.querySelector('[data-submit]')?.click();
      });
      await settle(page);
      assert.equal((await events(page)).length, 0, '播放失敗不可產生 review event');
      assert.equal(await page.locator('.feedback').count(), 0, '播放失敗不顯示作答對錯');
      await page.locator('[data-play]').last().click();
      await page.waitForFunction(() => window.speechProbe.utterances.length === 2);
      assert.equal(await page.locator('[data-opt]:not([disabled]),[data-input]:not([disabled])').count(), 0, '播放尚未完成也不可提交');
      await speechEvent(page, 'end');
      if (mode === 'listening') await page.locator(`[data-opt="${question.answerKey.correctIndex}"]`).click();
      else { await page.locator('[data-input]').fill(question.answerKey.accepted[0]); await page.locator('[data-submit]').click(); }
      await saved(page);
      assert.equal((await events(page)).length, 1);
      assert.match(await page.locator('.feedback').first().innerText(), /答對了/);
      assert.equal(await page.locator('[data-skip]').count(), 0, '已保存題不能跳過');
      assert.doesNotMatch(await page.locator('#app').innerText(), /播放失敗/);
      await page.locator('[data-play]').click();
      await page.waitForFunction(() => window.speechProbe.utterances.length === 3);
      await speechEvent(page, 'synthesis-failed');
      await settle(page);
      assert.equal((await events(page)).length, 1);
      assert.equal(await page.locator('[data-skip]').count(), 0);
      assert.match(await page.locator('.feedback').first().innerText(), /答對了/);
      assert.doesNotMatch(await page.locator('#app').innerText(), /不計分|尚未計分|跳過這題/, '已保存後重播失敗不推翻計分結果');
    });
  }

  await check('speech mock interrupted 不是成功且零事件', async page => {
    await startPractice(page, origin, 'listening');
    await page.waitForFunction(() => window.speechProbe.utterances.length === 1);
    await page.evaluate(async () => (await import('/assets/js/ui/speech.js')).cancel());
    await speechEvent(page, 'interrupted');
    await settle(page);
    await page.locator('[data-opt]').first().evaluate(el => el.click());
    await settle(page);
    assert.equal((await events(page)).length, 0);
    assert.equal(await page.locator('[data-skip]').count(), 1, '中斷後可選擇跳過或重播');
  });

  await check('speech mock 跳過鎖住本題，晚到回呼不碰下一題', async page => {
    await startPractice(page, origin, 'listening');
    await page.waitForFunction(() => window.speechProbe.utterances.length === 1);
    await page.evaluate(() => { window.practiceProbe.holdSkip = true; });
    await page.locator('[data-skip]').click();
    await page.waitForFunction(() => window.practiceProbe.skipReleases.length === 1);
    assert.equal(await page.locator('[data-skip]').isDisabled(), true);
    assert.equal(await page.locator('[data-quit]').isDisabled(), true);
    await page.locator('[data-skip]').evaluate(el => el.click());
    await page.evaluate(() => window.practiceProbe.skipReleases.shift()());
    await page.waitForFunction(() => window.speechProbe.utterances.length === 2);
    assert.match(await page.locator('.progress-text').innerText(), /第 2/);
    await speechEvent(page, 'synthesis-failed', 0);
    await settle(page);
    assert.equal(await page.locator('.notice').count(), 0, '前題失敗不覆蓋目前播放狀態');
    assert.equal((await events(page)).length, 0, '跳過不入帳');
    assert.equal(await page.evaluate(() => window.practiceProbe.skipCalls.length), 1, '連按不重複跳題');
    await speechEvent(page, 'end');
    const question = await page.evaluate(() => window.practiceProbe.round.questions[1]);
    await page.locator(`[data-opt="${question.answerKey.correctIndex}"]`).click();
    await saved(page);
    const rows = await events(page);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].entryId.endsWith(':1'), true, '只對目前題入帳');
  });

  await check('speech mock 舊 round 失敗不能覆蓋新 round', async page => {
    await startPractice(page, origin, 'listening');
    await page.waitForFunction(() => window.speechProbe.utterances.length === 1);
    await page.locator('[data-quit]').click();
    await page.locator('[data-set="mode"][data-value="typing"]').click();
    await page.locator('[data-start]:not([disabled])').click();
    await page.locator('[data-input]').waitFor();
    await page.evaluate(() => {
      window.lateSpeechMutations = 0;
      new MutationObserver(records => { window.lateSpeechMutations += records.length; })
        .observe(document.querySelector('#app'), { childList: true, subtree: true });
    });
    await speechEvent(page, 'synthesis-failed', 0);
    await settle(page);
    assert.equal(await page.evaluate(() => window.lateSpeechMutations), 0, '舊語音回呼不得重新渲染目前題目');
    assert.equal((await events(page)).length, 0);
  });

  await check('speech mock 跳過失敗保留錯誤與原題，能重試', async page => {
    await startPractice(page, origin, 'listening');
    await page.waitForFunction(() => window.speechProbe.utterances.length === 1);
    await page.evaluate(() => { window.practiceProbe.failSkip = true; });
    await page.locator('[data-skip]').click();
    await settle(page);
    assert.match(await page.locator('.backup-msg').innerText(), /沒有跳過/, '失敗訊息不被自動播放抹掉');
    assert.match(await page.locator('.progress-text').innerText(), /第 1/);
    assert.equal((await events(page)).length, 0);
    await page.locator('[data-skip]').click();
    await page.waitForFunction(() => document.querySelector('.progress-text').textContent.includes('第 2'));
    assert.equal((await events(page)).length, 0);
  });

  await check('speech mock 結束後失敗不拋例外', async page => {
    await startPractice(page, origin, 'listening');
    await page.waitForFunction(() => window.speechProbe.utterances.length === 1);
    await page.locator('[data-quit]').click();
    await page.locator('[data-start]').waitFor();
    await speechEvent(page, 'synthesis-failed', 0);
    await settle(page);
    assert.equal(await page.locator('[data-start]').count(), 1);
    assert.equal((await events(page)).length, 0);
  });

  await check('library 重繪保留未保存筆記', async page => {
    await page.goto(origin + '/en/library.html');
    await page.locator('[data-search]').fill('apple');
    await page.locator('[data-results] [data-fav]').first().click();
    await page.locator('[data-note]').first().click();
    const text = 'UNSAVED <b>純文字草稿</b>';
    await page.locator('[data-note-input]').fill(text);
    await page.locator('[data-want]').first().click();
    await page.locator('[data-want][aria-pressed="true"]').waitFor();
    assert.equal(await page.locator('[data-note-input]').inputValue(), text);
    await page.locator('[data-note-save]').click();
    await page.locator('[data-note-text]').waitFor();
    assert.equal(await page.locator('[data-note-text]').innerText(), text);
    assert.equal(await page.locator('[data-note-text] b').count(), 0);
  });

  for (const book of ['toString', 'constructor', '__proto__', 'missing', 'favorites']) {
    await check(`library URL book=${book} 只接受自有簿 ID`, async page => {
      await page.goto(`${origin}/en/library.html?book=${encodeURIComponent(book)}`);
      await page.locator('[data-search]').waitFor();
      assert.equal(await page.locator('[data-open][aria-pressed="true"]').count(), 1);
      assert.match(await page.locator('#app').innerText(), /這本還沒有本語言的字/);
    });
  }
  console.log(`upstream-regressions: ${passed} passed, ${failures.length} failed`);
  if (failures.length) throw new Error(failures.join('\n'));
}
