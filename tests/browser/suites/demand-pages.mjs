import assert from 'node:assert/strict';

/**
 * 空白隔離頁注入假題庫與可控制的 provider；不依賴 pageboot／catalog 或真實題庫。
 */
async function boot(page, origin, { kind = 'quiz', source = 'words', legacy = false, level = 1, now, holdToday = false } = {}) {
  await page.goto(origin + '/__harness__');
  await page.evaluate(async ({ kind, source, legacy, level, now, holdToday }) => {
    history.replaceState(null, '', '?source=' + source);
    if (now) Date.now = () => now;
    const words = [1, 2, 3, 4, 5].flatMap((level) => Array.from({ length: level === 1 ? 4 : 6 }, (_, i) => ({
      id: `ja-w-fixture-${level}-${i}`, target: `假字${level}-${i}`, zh: `假義${level}-${i}`,
      category: 'fixture', pos: 'noun', level,
    })));
    const sentences = Array.from({ length: 6 }, (_, i) => ({ id: `ja-s-fixture-${i}`,
      target: `假句${i}`, zh: `假句義${i}`, category: 'fixture', level: 2,
      chunks: [{ text: `片段${i}`, zh: '甲' }, { text: '後段', zh: '乙' }],
    }));
    const scenes = Array.from({ length: 4 }, (_, i) => ({ id: `ja-sc-fixture-${i}`, level: 1,
      context: `場合${i}`, options: [{ target: '正確', correct: true }, { target: '錯誤' }],
    }));
    const readings = [1, 2].map((level) => ({ id: `ja-r-fixture-${level}`, level,
      title: '假文章', passage: '假短文', translation: '假譯文', questions: Array.from({ length: 3 }, (_, i) => ({
        id: `ja-rq-fixture-${level}-${i}`, ask: { zh: '問題', target: '假問題' },
        options: [{ zh: '正確', target: '正', correct: true }, { zh: '錯誤', target: '誤' }],
      })),
    }));
    const data = { words, sentences, scenes, readings };
    const dataMeta = { words: words.length, sentences: 6, scenes: 4, readings: 2, readingQuestions: 6,
      wordsByLevel: { 1: 4, 2: 6, 3: 6, 4: 6, 5: 6 }, sentencesByLevel: { 2: 6 },
      scenesByLevel: { 1: 4 }, readingQuestionsByLevel: { 1: 3, 2: 3 } };
    const calls = [];
    const pending = [];
    const dataset = (source) => Object.fromEntries(({
      words: ['words'], sentences: ['sentences'], cloze: ['sentences'], mixed: ['words', 'sentences'],
      scene: ['scenes'], reading: ['readings'],
    })[source].map((key) => [key, data[key]]));
    const provider = (key) => {
      calls.push(key);
      return new Promise((resolve, reject) => pending.push({ key, resolve, reject }));
    };
    window.demand = { calls, data, pending, holdToday, today: [],
      resolve(index, value) { const p = pending[index]; p.resolve(value ?? (kind === 'quiz' ? dataset(p.key) : words.filter(w => w.level === p.key))); },
      reject(index) { pending[index].reject(new Error('fixture failure')); },
    };
    const mount = document.querySelector('#app');
    const noticeHost = document.createElement('div');
    document.body.append(noticeHost);
    const { setPref } = await import('/assets/js/ui/prefs.js');
    setPref('daily.ja.level', level);
    if (kind === 'quiz') {
      const { initQuizPage } = await import('/assets/js/ui/quiz-view.js');
      initQuizPage({ lang: 'ja', mount, noticeHost, ...(legacy ? data : {
        words: [], sentences: [], scenes: [], readings: [], dataMeta, dataProvider: provider,
      }) });
    } else {
      const { initDailyPage } = await import('/assets/js/ui/daily-view.js');
      initDailyPage({ lang: 'ja', mount, noticeHost, words: legacy ? words : [],
        ...(legacy ? {} : { wordProvider: provider }) });
    }
  }, { kind, source, legacy, level, now, holdToday });
}

const calls = (page) => page.evaluate(() => demand.calls);
const settle = (page, index, reject = false) => page.evaluate(({ index, reject }) => {
  demand[reject ? 'reject' : 'resolve'](index);
}, { index, reject });
const readyQuiz = (page) => page.locator('[data-start]:not([disabled])').waitFor();
const readyDaily = (page) => page.locator('[data-continue]:not([disabled])').waitFor();
const sourceChip = (page, source) => page.locator(`[data-set="source"][data-value="${source}"]`);
const levelChip = (page, level) => page.locator(`[data-set="level"][data-value="${level}"]`);
const readRows = (page, stores) => page.evaluate(async (stores) => {
  const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
  return (await getLearningStore().read(stores)).rows;
}, stores);

export async function run({ page, origin }) {
  await page.route('**/assets/js/ui/platform/daily-service.js', async (route) => {
    const response = await route.fetch();
    const original = (await response.text()).replace('export function createDailyService(', 'function baseDailyService(');
    await route.fulfill({ response, body: original + `
      export function createDailyService(options) {
        const service = baseDailyService(options);
        const today = service.today;
        service.today = async (settings) => {
          const view = await today(settings);
          if (!window.demand.holdToday) return view;
          return new Promise(resolve => window.demand.today.push({ level: settings.level, view, resolve }));
        };
        return service;
      }` });
  });
  await boot(page, origin, { source: 'sentences' });
  await page.waitForFunction(() => demand.calls.length === 1);
  assert.deepEqual(await calls(page), ['sentences'], '初始只讀網址選定題源');
  assert.equal(await page.locator('[data-start]').isDisabled(), true);
  assert.match(await sourceChip(page, 'words').innerText(), /28/);
  assert.match(await sourceChip(page, 'reading').innerText(), /6/, '閱讀顯示問題數，不是文章數');
  assert.match(await levelChip(page, 2).innerText(), /6/);
  await sourceChip(page, 'words').click();
  await page.waitForFunction(() => demand.calls.length === 2);
  await settle(page, 1);
  await readyQuiz(page);
  await levelChip(page, 1).click();
  assert.deepEqual(await calls(page), ['sentences', 'words'], 'quiz 切級別不讀 level pool');
  await settle(page, 0);
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 30)));
  assert.equal(await sourceChip(page, 'words').getAttribute('aria-pressed'), 'true', 'quiz 晚到句型不改選源');
  assert.match(await levelChip(page, 1).innerText(), /4/, '晚到句型不覆蓋單字級別');
  await page.evaluate(() => { demand.random = Math.random; Math.random = () => 0.42; });
  await page.locator('[data-start]').click();
  await page.locator('[data-opt]').first().waitFor();
  await page.evaluate(() => { Math.random = demand.random; });
  const rows = await readRows(page, ['sessions']);
  const round = Object.values(rows.sessions).find(s => s.status === 'active');
  const qs = Object.values(round.questionSnapshots);
  assert.equal(qs.length, 4);
  assert.ok(qs.every(q => q.level === 1), '難度只篩題目');
  assert.ok(qs.some(q => q.options.some(o => /^假字[2-5]-/.test(o.text))), '完整題源干擾選項可跨級');
  await page.locator('[data-opt]').first().click();
  await page.waitForFunction(() => !document.querySelector('[data-next]').disabled);
  const saved = await readRows(page, ['sessions']);
  const savedRound = saved.sessions[round.sessionId];
  const expected = savedRound.questionSnapshots[savedRound.orderedEntryIds[1]].prompt;
  await boot(page, origin, { source: 'reading' });
  await page.locator('[data-resume-quiz]').waitFor();
  await page.locator('[data-resume-quiz]').click();
  await page.locator('[data-opt]').first().waitFor();
  assert.equal(await page.locator('.prompt').innerText(), expected, 'resume 不等待全新題庫');
  await settle(page, 0);
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 30)));
  assert.equal(await page.locator('.prompt').innerText(), expected, 'provider 晚到不覆蓋已恢復 session');
  assert.equal(Object.keys((await readRows(page, ['reviewEvents'])).reviewEvents).length, 1);

  await boot(page, origin, { source: 'reading' });
  await page.waitForFunction(() => demand.calls.length === 1);
  await settle(page, 0, true);
  await page.locator('[data-source-retry]').waitFor();
  assert.equal(await page.locator('[data-start]').isDisabled(), true);
  assert.match(await page.locator('[role="status"]').innerText(), /載入失敗/);
  await page.locator('[data-source-retry]').click();
  await page.waitForFunction(() => demand.calls.length === 2);
  await settle(page, 1);
  await readyQuiz(page);
  assert.match(await sourceChip(page, 'reading').innerText(), /6/);
  await sourceChip(page, 'mixed').click();
  await page.waitForFunction(() => demand.calls.length === 3);
  await settle(page, 2);
  await readyQuiz(page);
  assert.match(await sourceChip(page, 'mixed').innerText(), /34/);
  await sourceChip(page, 'cloze').click();
  await readyQuiz(page);
  assert.deepEqual(await calls(page), ['reading', 'reading', 'mixed'], '已讀 sentences 可重用於 cloze');
  await sourceChip(page, 'scene').click();
  await page.waitForFunction(() => demand.calls.length === 4);
  await sourceChip(page, 'words').click();
  await readyQuiz(page);
  await settle(page, 3, true);
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 30)));
  assert.equal(await page.locator('[data-source-retry]').count(), 0, '返回已快取來源後，舊來源失敗不覆蓋狀態');
  assert.deepEqual(await calls(page), ['reading', 'reading', 'mixed', 'scene']);

  await boot(page, origin, { kind: 'daily', level: 2 });
  await page.waitForFunction(() => demand.calls.length === 1);
  assert.deepEqual(await calls(page), [2], 'daily 首次依 prefs 級別載入');
  await levelChip(page, 1).click();
  await page.waitForFunction(() => demand.calls.length === 2);
  await settle(page, 1);
  await readyDaily(page);

  await settle(page, 0);
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 30)));
  assert.equal(await levelChip(page, 1).getAttribute('aria-pressed'), 'true', 'daily 晚到 N4 不改選級');
  assert.ok((await page.locator('.daily-word').allTextContents()).every(s => s.startsWith('假字1-')));
  await page.locator('[data-continue]').click();
  await page.locator('[data-start]').click();
  await page.locator('[data-opt]').first().waitFor();
  let dailyRows = await readRows(page, ['dailyPlans', 'dailyLedger']);
  const firstPlan = Object.values(dailyRows.dailyPlans).find(p => p.level === 'N5');
  const prepared = firstPlan.orderedEntries.find(e => e.status === 'prepared');
  assert.ok(prepared.questionSnapshot.options.every(o => /ja-w-fixture-1-/.test(o.id)), 'daily service 完整同級選項');
  await page.locator(`[data-opt="${prepared.questionSnapshot.correctIndex}"]`).click();
  await page.waitForFunction(() => !document.querySelector('[data-next]').disabled);
  await page.locator('[data-back]').click();
  await readyDaily(page);
  await levelChip(page, 2).click();
  await page.waitForFunction(() => demand.calls.length === 3);
  await settle(page, 2);
  await readyDaily(page);
  dailyRows = await readRows(page, ['dailyPlans', 'dailyLedger']);
  assert.equal(Object.values(dailyRows.dailyLedger).length, 1, '切級別共用語言 ledger');
  assert.equal(Object.values(dailyRows.dailyLedger)[0].startedSourceIds.length, 1);
  assert.equal(Object.values(dailyRows.dailyPlans).find(p => p.level === 'N4').orderedEntries.length, 4);
  await levelChip(page, 1).click();
  await readyDaily(page);
  assert.match(await page.locator('.daily-summary').innerText(), /已完成 1/);
  await page.locator('[data-continue]').click();
  assert.ok(!(await page.locator('.prompt').innerText()).includes(prepared.questionSnapshot.target), '已存答案不再次選中');

  await boot(page, origin, { kind: 'daily', level: 3 });
  await page.waitForFunction(() => demand.calls.length === 1);
  await settle(page, 0, true);
  await page.locator('[data-words-retry]').waitFor();
  assert.match(await page.locator('.backup-msg').innerText(), /載入失敗/);
  assert.equal(await page.locator('[data-continue]').count(), 0);
  await page.locator('[data-words-retry]').click();
  await page.waitForFunction(() => demand.calls.length === 2);
  await settle(page, 1);
  await readyDaily(page);

  await boot(page, origin, { kind: 'daily', level: 4, holdToday: true });
  await page.waitForFunction(() => demand.calls.length === 1);
  await settle(page, 0);
  await page.waitForFunction(() => demand.today.length === 1);
  await levelChip(page, 5).click();
  await page.waitForFunction(() => demand.calls.length === 2);
  await settle(page, 1);
  await page.waitForFunction(() => demand.today.length === 2);
  await page.evaluate(() => { demand.today[1].resolve(demand.today[1].view); });
  await readyDaily(page);
  await page.evaluate(() => { demand.today[0].resolve(demand.today[0].view); });
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 30)));
  assert.equal(await levelChip(page, 5).getAttribute('aria-pressed'), 'true', 'today() 晚回傳仍受相同世代守衛');
  assert.ok((await page.locator('.daily-word').allTextContents()).every(s => s.startsWith('假字5-')));

  const firstDay = await page.evaluate(() => Date.now() + 86400000);
  await boot(page, origin, { kind: 'daily', level: 5, now: firstDay });
  await page.waitForFunction(() => demand.calls.length === 1);
  await settle(page, 0);
  await readyDaily(page);
  await page.locator('[data-continue]').click();
  await page.locator('[data-start]').click();
  await page.locator('[data-opt]').first().waitFor();
  const carryOrigin = Object.values((await readRows(page, ['dailyPlans'])).dailyPlans)
    .find(p => p.level === 'N1' && p.generatedAt === firstDay);
  const carryEntry = carryOrigin.orderedEntries.find(e => e.status === 'prepared');
  await boot(page, origin, { kind: 'daily', level: 5, now: firstDay + 86400000 });
  await page.waitForFunction(() => demand.calls.length === 1);
  await page.evaluate((missingId) => {
    demand.resolve(0, demand.data.words.filter(w => w.level === 5 && w.id !== missingId));
  }, carryEntry.sourceId);
  await readyDaily(page);
  assert.match(await page.locator('.daily-word').innerText(), new RegExp(carryEntry.questionSnapshot.target));
  await page.locator('[data-continue]').click();
  await page.locator('[data-opt]').first().waitFor();
  assert.equal(await page.locator('.prompt').evaluate((node) => {
    const copy = node.cloneNode(true);
    copy.querySelectorAll('button').forEach(button => button.remove());
    return copy.textContent.trim();
  }), carryEntry.questionSnapshot.prompt, '來源已移除仍沿用 carry 快照');
  const carried = Object.values((await readRows(page, ['dailyPlans'])).dailyPlans)
    .find(p => p.level === 'N1' && p.generatedAt === firstDay + 86400000);
  assert.deepEqual(carried.orderedEntries[0].questionSnapshot, carryEntry.questionSnapshot);
  await page.locator(`[data-opt="${carryEntry.questionSnapshot.correctIndex}"]`).click();
  await page.waitForFunction(() => !document.querySelector('[data-next]').disabled);
  await page.locator('[data-next]').click();
  await page.waitForFunction(() => document.querySelector('.daily-summary')?.textContent.includes('已完成 1'));
  assert.equal(await page.locator('[data-continue]').count(), 0, 'carry 已存答案不再選中');
  assert.equal(await page.evaluate(async () => {
    const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
    const { validateLearning } = await import('/assets/js/core/learning-schema.js');
    return validateLearning((await getLearningStore().exportBackup()).learning).ok;
  }), true, '跨級 ledger、續答與 carry 的完整學習資料仍可攜');

  await boot(page, origin, { legacy: true });
  await readyQuiz(page);
  assert.deepEqual(await calls(page), [], '舊 quiz 陣列注入相容');
  await boot(page, origin, { kind: 'daily', legacy: true, level: 1 });
  await readyDaily(page);
  assert.deepEqual(await calls(page), [], '舊 daily 陣列注入相容');
}
