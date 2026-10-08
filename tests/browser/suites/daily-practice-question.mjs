import assert from 'node:assert/strict';

/**
 * 獨立嵌入元件的真實 Chromium DOM 測試。語音事件與保存 Promise 可控，
 * 不連使用者瀏覽器、不寫學習紀錄；每日交易整合由 daily 專屬 suite 驗證。
 */
async function boot(page, origin, mode = 'typing', options = {}) {
  await page.goto(origin + '/__harness__');
  await page.evaluate(async ({ mode, options }) => {
    speechProbe.noVoice = options.noVoice === true;
    const { buildPracticeQuestion, judgePractice } = await import('/assets/js/core/practice-engine.js');
    const { mountDailyPracticeQuestion } = await import('/assets/js/ui/daily-practice-question.js');
    const lang = mode === 'kana' ? 'ja' : 'en';
    const item = { id: `${lang}-x-999`, sourceId: `${lang}-w-999`, level: 1, mode, prompt: '人工提示 <svg onload="bad()">' };
    if (mode === 'typing') Object.assign(item, { accepted: ['secret-typing-answer'] });
    if (mode === 'kana') Object.assign(item, { prompt: '学校', accepted: ['がっこう'] });
    if (mode === 'listening') Object.assign(item, { speakText: 'SECRET_SPEAK', context: 'SECRET_CONTEXT', options: ['中文甲', '中文乙'], correctIndex: 1 });
    if (mode === 'dictation') Object.assign(item, { speakText: 'SECRET_DICTATION', accepted: ['SECRET_DICTATION'] });
    if (mode === 'tiles') Object.assign(item, { fragments: ['a', 'b', 'a'], answer: 'aba' });
    if (mode === 'reorder') Object.assign(item, { chunks: ['I', 'run'], legalOrders: [[0, 1]] });
    if (mode === 'pos') Object.assign(item, { sentence: 'My cat sleeps.', targetWord: 'cat', position: 3, options: ['名詞', '動詞'], correctIndex: 0 });
    const question = buildPracticeQuestion(item, () => 0.3);
    let answer;
    if (question.answerKey.accepted) answer = { input: question.answerKey.accepted[0] };
    else if (question.options) answer = { selectedIndex: question.answerKey.correctIndex };
    else if (mode === 'reorder') answer = { instanceIds: question.answerKey.legalOrders[0].map(index =>
      Object.keys(question.answerKey.chunkIndexByInstance).find(id => question.answerKey.chunkIndexByInstance[id] === index)) };
    else {
      const used = new Set();
      answer = { instanceIds: [...question.answerKey.answer].map(text => {
        const piece = question.fragments.find(row => row.text === text && !used.has(row.instanceId));
        used.add(piece.instanceId); return piece.instanceId;
      }) };
    }
    window.fixture = { question, answer, calls: [], saves: [], backs: 0 };
    fixture.controller = mountDailyPracticeQuestion({ mount: document.querySelector('#app'), question, lang,
      response: options.saved ? answer : null,
      feedback: options.saved ? { saved: true, correct: true } : null, disabled: options.disabled === true,
      onBack() { fixture.backs += 1; document.querySelector('#app').textContent = '已返回清單'; },
      onSubmit(response, meta) {
        fixture.calls.push({ response, meta });
        if (options.throwSync && fixture.calls.length === 1) throw new Error('測試同步例外');
        return new Promise((resolve, reject) => fixture.saves.push({
          resolve: () => resolve({ saved: true, correct: judgePractice(question, response).correct }),
          unconfirmed: () => resolve({ correct: true }), reject: () => reject(new Error('測試保存失敗')),
        }));
      },
    });
  }, { mode, options });
}

async function playSuccess(page) {
  await page.locator('[data-dp-play]').click();
  await page.waitForFunction(() => speechProbe.current !== null);
  await page.evaluate(() => speechProbe.finish());
  await page.waitForFunction(() => fixture.controller.getState().played && !fixture.controller.getState().playing);
}

async function answer(page) {
  const response = await page.evaluate(() => fixture.answer);
  if (response.input !== undefined) {
    await page.locator('[data-dp-input]').fill(response.input);
    await page.locator('[data-dp-submit]').click();
  } else if (response.selectedIndex !== undefined) {
    await page.locator(`[data-dp-option="${response.selectedIndex}"]`).click();
  } else {
    for (const id of response.instanceIds) await page.locator(`[data-dp-pick="${id}"]`).click();
    await page.locator('[data-dp-submit]').click();
  }
  await page.waitForFunction(() => fixture.calls.length === 1);
}

export async function run({ page, origin }) {
  await page.addInitScript(() => {
    window.speechProbe = { current: null,
      finish() { const utterance = this.current; this.current = null; utterance.dispatchEvent(new Event('end')); },
      fail() { const utterance = this.current; this.current = null; const event = new Event('error'); event.error = 'synthesis-failed'; utterance.dispatchEvent(event); },
    };
    window.SpeechSynthesisUtterance = class extends EventTarget { constructor(text) { super(); this.text = text; } };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => speechProbe.noVoice ? [] : [{ lang: 'en-US', localService: true }, { lang: 'ja-JP', localService: true }],
      addEventListener() {}, removeEventListener() {},
      speak(utterance) { speechProbe.current = utterance; },
      cancel() {
        if (!speechProbe.current) return;
        const utterance = speechProbe.current; speechProbe.current = null;
        const event = new Event('error'); event.error = 'interrupted';
        queueMicrotask(() => utterance.dispatchEvent(event));
      },
    } });
  });

  await boot(page, origin);
  await page.evaluate(() => {
    fixture.statusNode = document.querySelector('[role="status"]');
    fixture.inputNode = document.querySelector('[data-dp-input]');
  });
  await page.locator('[data-dp-input]').press('Enter');
  assert.equal(await page.evaluate(() => fixture.statusNode === document.querySelector('[role="status"]')), true,
    '無效作答仍更新同一個常駐 live region，不重建帶文字的節點');
  assert.match(await page.locator('[role="status"]').innerText(), /尚未輸入/);
  await page.locator('[data-dp-input]').fill('尚未提交的草稿');
  await page.evaluate(() => {
    fixture.inputNode.setSelectionRange(2, 4);
    fixture.controller.update({ disabled: false });
  });
  assert.deepEqual(await page.evaluate(() => ({ same: fixture.inputNode === document.querySelector('[data-dp-input]'),
    focused: document.activeElement === fixture.inputNode, value: fixture.inputNode.value,
    start: fixture.inputNode.selectionStart, end: fixture.inputNode.selectionEnd })),
  { same: true, focused: true, value: '尚未提交的草稿', start: 2, end: 4 }, '一般重畫保留輸入節點、草稿、焦點與選取範圍');

  for (const mode of ['tiles', 'reorder']) {
    await boot(page, origin, mode);
    const total = await page.locator('[data-dp-pick]').count();
    await page.locator('[data-dp-pick]').first().focus();
    for (let i = 0; i < total; i++) {
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => document.activeElement.matches('[data-dp-pick]:not([disabled]), [data-dp-submit]:not([disabled])')),
        true, `${mode} 選片段後焦點留在下一片段或提交，不掉到 body`);
    }
    assert.equal(await page.evaluate(() => document.activeElement.matches('[data-dp-submit]')), true);
    const returnedId = await page.locator('[data-dp-unpick]').first().getAttribute('data-dp-unpick');
    await page.locator('[data-dp-unpick]').first().focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.dpPick), returnedId, '移回後聚焦剛恢復可用的片段');
    await page.locator('[data-dp-clear]').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.matches('[data-dp-pick]:not([disabled])')), true, '清除後回到可用片段');
  }

  await boot(page, origin, 'dictation');
  await page.locator('[data-dp-input]').fill('existing draft');
  await page.evaluate(() => {
    fixture.statusNode = document.querySelector('[role="status"]');
    fixture.inputNode = document.querySelector('[data-dp-input]');
    fixture.inputNode.setSelectionRange(3, 3);
  });
  await playSuccess(page);
  assert.deepEqual(await page.evaluate(() => ({ sameStatus: fixture.statusNode === document.querySelector('[role="status"]'),
    sameInput: fixture.inputNode === document.querySelector('[data-dp-input]'), focused: document.activeElement === fixture.inputNode,
    value: fixture.inputNode.value, caret: fixture.inputNode.selectionStart })),
  { sameStatus: true, sameInput: true, focused: true, value: 'existing draft', caret: 3 }, '播放完成定位原輸入，不覆寫草稿或游標');
  await page.locator('[data-dp-play]').click();
  await page.evaluate(() => {
    const outside = document.createElement('button'); outside.id = 'outside'; outside.textContent = '其他操作';
    document.body.append(outside); outside.focus(); speechProbe.finish();
  });
  await page.waitForFunction(() => !fixture.controller.getState().playing);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'outside', '播放完成不能搶走使用者已移到外面的焦點');
  await page.evaluate(() => fixture.controller.update({ disabled: false }));
  assert.equal(await page.evaluate(() => document.activeElement.id), 'outside', '一般 update 也不搶無關焦點');
  await boot(page, origin, 'listening');
  await playSuccess(page);
  assert.equal(await page.evaluate(() => document.activeElement.matches('[data-dp-option]:not([disabled])')), true, '聽力選項播放完成定位作答');

  for (const mode of ['typing', 'kana', 'listening', 'dictation', 'tiles', 'reorder', 'pos']) {
    await boot(page, origin, mode);
    const before = await page.locator('#app').innerHTML();
    assert.doesNotMatch(before, /answerKey|SECRET_|secret-typing-answer|data-speak=|is-correct|<svg/, `${mode} 答前不輸出秘密欄位或未跳脫 HTML`);
    if (['listening', 'dictation'].includes(mode)) await playSuccess(page);
    await answer(page);
    assert.equal(await page.locator('[data-dp-feedback]').count(), 0, `${mode} 保存完成前無對錯回饋`);
    assert.equal(await page.locator('#app button:not([disabled]), #app input:not([disabled])').count(), 0, `${mode} pending 鎖住全部本題控制項`);
    await page.evaluate(() => {
      const button = document.querySelector('[data-dp-submit], [data-dp-option]');
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      document.querySelector('.daily-practice-question').dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
    });
    assert.equal(await page.evaluate(() => fixture.calls.length), 1, `${mode} pending 不能重送或改答案`);
    await page.evaluate(() => fixture.saves[0].resolve());
    await page.locator('[data-dp-feedback]').waitFor();
    assert.match(await page.locator('[data-dp-feedback]').innerText(), /答對了/);
    assert.equal(await page.evaluate(() => fixture.controller.getState().saved), true);
  }

  await boot(page, origin);
  await page.locator('[data-dp-input]').fill('  ');
  await page.locator('[data-dp-submit]').click();
  assert.equal(await page.evaluate(() => fixture.calls.length), 0, '空白答案不呼叫保存、不產生事件');
  await page.locator('[data-dp-input]').fill('secret-typing-answer');
  await page.locator('[data-dp-input]').dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  await page.locator('[data-dp-input]').dispatchEvent('keydown', { key: 'Enter', keyCode: 229 });
  assert.equal(await page.evaluate(() => fixture.calls.length), 0, 'IME Enter 不提交');
  await page.locator('[data-dp-input]').press('Enter');
  await page.evaluate(() => fixture.saves[0].reject());
  await page.locator('[data-dp-retry]').waitFor();
  assert.equal(await page.locator('[data-dp-input]').isDisabled(), true, '保存失敗保留且鎖住原答案');
  assert.equal(await page.locator('[data-dp-feedback]').count(), 0, '保存失敗不提前顯示正解');
  await page.locator('[data-dp-retry]').click();
  assert.deepEqual(await page.evaluate(() => fixture.calls[1]), await page.evaluate(() => fixture.calls[0]), '重試沿用相同 response 與 replayCount');
  await page.evaluate(() => fixture.saves[1].resolve());
  await page.locator('[data-dp-feedback]').waitFor();

  await boot(page, origin, 'tiles');
  await page.locator('[data-dp-submit]').click();
  assert.equal(await page.evaluate(() => fixture.calls.length), 0, '空片段答案不提交');
  await page.locator('[data-dp-pick]').first().click();
  await page.locator('[data-dp-unpick]').click();
  assert.equal(await page.locator('[data-dp-unpick]').count(), 0, '片段可移回');

  for (const mode of ['listening', 'dictation']) {
    await boot(page, origin, mode);
    await page.evaluate(() => {
      if (document.querySelector('[data-dp-input]')) {
        const input = document.querySelector('[data-dp-input]'); input.value = 'SECRET_DICTATION';
        input.dispatchEvent(new Event('input')); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      } else document.querySelector('[data-dp-option]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    assert.equal(await page.evaluate(() => fixture.calls.length), 0, `${mode} 未播放不能提交`);
    await page.locator('[data-dp-play]').click();
    await page.evaluate(() => speechProbe.fail());
    await page.waitForFunction(() => !fixture.controller.getState().playing);
    assert.equal(await page.evaluate(() => fixture.controller.getState().played), false);
    assert.match(await page.locator('[role="status"]').innerText(), /播放未成功/);
    assert.equal(await page.evaluate(() => fixture.calls.length), 0, `${mode} 播放失敗不計錯`);
    await playSuccess(page);
    await page.locator('[data-dp-play]').click();
    await page.evaluate(async () => { (await import('/assets/js/ui/speech.js')).cancel(); });
    await page.waitForFunction(() => !fixture.controller.getState().playing);
    assert.equal(await page.evaluate(() => fixture.controller.getState().played), false, `${mode} 中斷的重播不能沿用先前成功狀態`);
    await playSuccess(page);
    await answer(page);
    assert.equal(await page.evaluate(() => fixture.calls[0].meta.replayCount), 1, '只計成功重播');
    await page.evaluate(() => fixture.saves[0].resolve());
    await page.locator('[data-dp-feedback]').waitFor();
  }

  await boot(page, origin, 'dictation');
  await page.locator('[data-dp-play]').click();
  await page.locator('[data-dp-back]').click();
  await page.waitForTimeout(20);
  assert.equal(await page.locator('#app').innerText(), '已返回清單', '播放中可以返回，晚到語音事件不能重畫');
  assert.equal(await page.evaluate(() => fixture.backs), 1);
  await boot(page, origin, 'dictation');
  await page.locator('[data-dp-play]').click();
  await page.evaluate(() => speechProbe.fail());
  await page.waitForFunction(() => !fixture.controller.getState().playing);
  await page.locator('[data-dp-back]').click();
  assert.equal(await page.locator('#app').innerText(), '已返回清單', '播放失敗仍有路返回');
  await boot(page, origin, 'dictation', { noVoice: true });
  await page.locator('[data-dp-play]').click();
  await page.waitForFunction(() => !fixture.controller.getState().playing);
  assert.equal(await page.evaluate(() => fixture.controller.getState().played), false, '缺本機語音不冒充播放成功');
  assert.equal(await page.evaluate(() => fixture.calls.length), 0);
  await page.locator('[data-dp-back]').click();
  assert.equal(await page.locator('#app').innerText(), '已返回清單', '缺本機語音仍可返回');
  await boot(page, origin);
  await answer(page);
  await page.evaluate(() => { fixture.controller.destroy(); document.querySelector('#app').textContent = '新畫面'; fixture.saves[0].resolve(); });
  await page.waitForTimeout(20);
  assert.equal(await page.locator('#app').innerText(), '新畫面', '離頁後晚到保存不能重畫');

  await boot(page, origin, 'typing', { disabled: true });
  assert.equal(await page.locator('[data-dp-input]').isDisabled(), true);
  await page.evaluate(() => fixture.controller.update({ disabled: false }));
  await answer(page);
  await page.evaluate(() => fixture.saves[0].unconfirmed());
  await page.locator('[data-dp-retry]').waitFor();
  assert.equal(await page.locator('[data-dp-feedback]').count(), 0, '只有 correct 而缺保存確認不算成功');
  await boot(page, origin, 'typing', { saved: true });
  assert.match(await page.locator('[data-dp-feedback]').innerText(), /答對了/);
  assert.equal(await page.locator('[data-dp-input]').inputValue(), 'secret-typing-answer');
  assert.equal(await page.locator('[data-dp-input]').isDisabled(), true);
  assert.equal(await page.evaluate(() => fixture.calls.length), 0, '已保存重畫不再次提交');

  await boot(page, origin, 'typing', { throwSync: true });
  await answer(page);
  await page.locator('[data-dp-retry]').waitFor();
  assert.equal(await page.locator('[data-dp-input]').isDisabled(), true, '同步 throw 也鎖住原答案');
  await page.locator('[data-dp-retry]').click();
  assert.deepEqual(await page.evaluate(() => fixture.calls[1]), await page.evaluate(() => fixture.calls[0]));
  await page.evaluate(() => fixture.saves[0].resolve());
  await page.locator('[data-dp-feedback]').waitFor();
}
