import assert from 'node:assert/strict';

/**
 * 首頁實際 DOM、下載／匯入與真 IndexedDB；清除僅限 runner 的隔離 loopback context。
 * 收藏、提醒走頁面操作，僅意向與指定偏好用正式 service 建立獨立前置資料。
 */
export async function run({ page, origin }) {
  const failures = [];
  const home = async () => {
    await page.goto(origin + '/');
    await page.locator('#backup [data-export]').waitFor();
  };
  const fresh = async () => {
    await page.goto(origin + '/__harness__');
    await page.evaluate(async () => {
      const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
      await getLearningStore().clearAll();
      localStorage.clear();
    });
    await home();
  };
  const check = async (name, work) => {
    await fresh();
    try { await work(); console.log('  PASS ' + name); }
    catch (error) { failures.push(name + ': ' + error.message); }
  };
  const assertExport = async (enabled, summary) => {
    assert.equal(await page.locator('#backup [data-export]').isDisabled(), !enabled, '下載開關');
    assert.equal(await page.locator('#backup [data-copy-code]').isDisabled(), !enabled, '代碼開關');
    const text = await page.locator('#backup .backup-now').first().textContent();
    if (summary) assert.match(text, summary);
    if (enabled) assert.doesNotMatch(text, /還沒有任何紀錄/);
  };
  const download = async () => {
    const pending = page.waitForEvent('download');
    await page.locator('#backup [data-export]').click();
    const file = await pending;
    const chunks = [];
    for await (const chunk of await file.createReadStream()) chunks.push(chunk);
    const backup = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(backup.version, 2);
    return backup;
  };
  const importPrefs = async (prefs, version = 1) => {
    const payload = version === 2 ? await page.evaluate(async (prefs) => {
      const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
      return getLearningStore().exportBackup({ prefs });
    }, prefs) : { format: 'lang-learn.backup', version: 1, exportedAt: 123, prefs };
    await page.locator('#backup [data-file]').setInputFiles({ name: 'legacy-prefs.json',
      mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)) });
    await page.locator('#backup [data-confirm]').click();
    await page.waitForFunction(() => document.querySelector('#backup .backup-msg').textContent.startsWith('已還原'));
    return page.evaluate(async () => (await import('/assets/js/ui/prefs.js')).loadPrefs());
  };

  await check('全新與顯式預設偏好不啟用匯出', async () => {
    await assertExport(false, /還沒有任何紀錄/);
    await page.evaluate(async () => {
      const { loadPrefs, savePrefs } = await import('/assets/js/ui/prefs.js');
      const { defaultFeedbackPrefs } = await import('/assets/js/core/feedback-policy.js');
      savePrefs({ ...loadPrefs(), ...defaultFeedbackPrefs(), hideKanji: false });
    });
    await home();
    await assertExport(false);
  });

  await check('偏好預設單一來源漂移護欄：每個正式預設還原停用、單項變更啟用', async () => {
    const defaults = await page.evaluate(async () => ({
      ...(await import('/assets/js/ui/prefs.js')).loadPrefs(),
      ...(await import('/assets/js/core/feedback-policy.js')).defaultFeedbackPrefs(),
    }));
    const alternatives = { theme: ['dark', 'light'], palette: ['classic', 'forest'], background: ['aurora', 'plain'],
      kanaMode: ['both', 'hiragana'], readingAskIn: ['zh', 'target'], kanjiMode: ['show', 'kana'] };
    for (const [key, value] of Object.entries(defaults)) {
      const changed = typeof value === 'boolean' ? !value : alternatives[key]?.find(candidate => candidate !== value);
      assert.notEqual(changed, undefined, `新增偏好 ${key} 須補合法變更案例與備份判定`);
      for (const modified of [true, false]) {
        await page.evaluate(async ({ prefs }) => {
          const { savePrefs, PREFS_IMPORTED_EVENT } = await import('/assets/js/ui/prefs.js');
          savePrefs(prefs);
          window.dispatchEvent(new Event(PREFS_IMPORTED_EVENT));
        }, { prefs: modified ? { ...defaults, [key]: changed } : defaults });
        await assertExport(modified, modified ? /自訂偏好\s+1\s+項/ : /還沒有任何紀錄/);
      }
    }
  });

  for (const [kind, summary] of [
    ['session', /學習場次\s+1\s+局/], ['ledger', /每日帳本\s+1\s+份/],
    ['unlock', /成就解鎖\s+1\s+項/], ['calendar', /學習日曆\s+1\s+筆/],
    ['event', /作答歷程\s+1\s+筆/], ['reminder-generation', /提醒設定\s+1\s+組/],
  ]) {
    await check(`合法 v2 最小內容可匯入再匯出：${kind}`, async () => {
      const fixture = await page.evaluate(async (kind) => {
        const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
        const { validateLearning } = await import('/assets/js/core/learning-schema.js');
        const { parseLearningBackup } = await import('/assets/js/core/learning-backup.js');
        const backup = await getLearningStore().exportBackup();
        const learning = backup.learning;
        const at = 123;
        const session = { sessionId: 'backup-session', lang: 'en', source: 'words', mode: 'target2zh', planId: null,
          orderedEntryIds: ['backup-entry'], submittedReviewIds: [],
          questionSnapshots: { 'backup-entry': { sourceId: 'en-w-001' } }, status: 'active', createdAt: at, completedAt: null };
        if (kind === 'session' || kind === 'event') learning.sessions[session.sessionId] = session;
        if (kind === 'ledger') learning.dailyLedger['2026-10-08:en'] = { ledgerId: '2026-10-08:en',
          localDate: '2026-10-08', timeZone: learning.meta.timeZone, lang: 'en', startedSourceIds: ['en-w-001'],
          excludedSourceIds: [], newLimit: 5, updatedAt: at };
        if (kind === 'unlock') learning.achievements.unlocked['first-review'] = {
          achievementId: 'first-review', unlockedAt: at, notifiedAt: null };
        if (kind === 'calendar') learning.achievements.calendar['2026-10-08:en'] = {
          localDate: '2026-10-08', lang: 'en', reviewCount: 1, correctCount: 1 };
        if (kind === 'reminder-generation') learning.reminderPreferences.generation = 1;
        let eventOnlyValid;
        if (kind === 'event') {
          const { skillKeyFor } = await import('/assets/js/core/learning-identity.js');
          const ability = { sourceId: 'en-w-001', ability: 'recognition', direction: 'target2zh' };
          const skillKey = skillKeyFor(ability);
          learning.reviewEvents['backup-review'] = { reviewId: 'backup-review', sessionId: session.sessionId,
            planId: null, entryId: 'backup-entry', sourceId: ability.sourceId, skillKey, answeredAt: at, correct: true,
            assistance: { hintUsed: false, retry: false, replayCount: 0 }, responseMs: null, questionMode: 'target2zh',
            scheduleEligible: true, schedulerVersion: 'leitner-v1', before: null, after: null };
          eventOnlyValid = validateLearning({ ...learning, sessions: {} }).ok;
          session.submittedReviewIds = ['backup-review'];
          learning.itemStates[skillKey] = { ...ability, skillKey, legacySummary: null, schedulerName: 'leitner',
            schedulerVersion: 'leitner-v1', schedulerState: { box: 1 }, due: at, lastEligibleReviewAt: at, learningStatus: 'learning' };
        }
        const checked = validateLearning(learning);
        const parsed = parseLearningBackup(JSON.stringify(backup));
        return { backup, checked, accepted: parsed.ok && parsed.errors.length === 0, eventOnlyValid };
      }, kind);
      assert.equal(fixture.checked.ok, true, JSON.stringify(fixture.checked.errors));
      assert.equal(fixture.accepted, true, '由正式 v2 parser 接受，不使用非法資料放寬匯出開關');
      if (kind === 'event') assert.equal(fixture.eventOnlyValid, false, '孤立事件缺少能力/session 引用，不能合法匯入');
      await page.locator('#backup [data-file]').setInputFiles({ name: `${kind}-only.json`,
        mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture.backup)) });
      await page.locator('#backup [data-confirm]').click();
      await page.waitForFunction(() => document.querySelector('#backup .backup-msg').textContent.startsWith('已還原'));
      await assertExport(true, summary);
      const exported = await download();
      for (const key of ['sessions', 'dailyLedger', 'achievements', 'reviewEvents', 'itemStates', 'reminderPreferences']) {
        assert.deepEqual(exported.learning[key], fixture.backup.learning[key], `${kind}: ${key} 往返內容不減少`);
      }
    });
  }

  await check('只有預設收藏簿內的收藏可下載與產生代碼', async () => {
    await page.goto(origin + '/en/vocabulary.html');
    const star = page.locator('[data-favorite]').first();
    const wordId = await star.getAttribute('data-favorite');
    await star.click();
    await page.waitForFunction(() => document.querySelector('[data-favorite]')?.getAttribute('aria-pressed') === 'true');
    await home();
    await assertExport(true, /收藏\s+1\s+字/);
    assert.match(await page.locator('#backup .backup-now').first().textContent(), /單字簿\s+1\s+本/);
    const backup = await download();
    assert.deepEqual(backup.learning.library.books.favorites.wordIds, [wordId]);
    assert.deepEqual(backup.progress.items, {});
    await page.locator('#backup [data-copy-code]').click();
    await page.waitForFunction(() => document.querySelector('#backup [data-code]').value.startsWith('langlearn'));
    const codeBackup = await page.evaluate(async () => {
      const { decodeBackupCode } = await import('/assets/js/core/backup-code.js');
      return JSON.parse(await decodeBackupCode(document.querySelector('#backup [data-code]').value));
    });
    assert.deepEqual(codeBackup.learning.library.books.favorites.wordIds, [wordId]);
  });

  await check('只剩意向仍可匯出，撤回後恢復停用', async () => {
    await page.evaluate(async () => {
      const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
      const { createLibraryService } = await import('/assets/js/ui/platform/library-service.js');
      await createLibraryService({ store: getLearningStore() }).setWant('en-w-001', true);
    });
    await home();
    await assertExport(true, /學習意向\s+1\s+筆/);
    const backup = await download();
    assert.equal(backup.learning.intents['en-w-001'].wantToLearn, true);
    assert.deepEqual(backup.learning.library.books.favorites.wordIds, []);
    await page.evaluate(async () => {
      const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
      const { createLibraryService } = await import('/assets/js/ui/platform/library-service.js');
      await createLibraryService({ store: getLearningStore() }).setWant('en-w-001', false);
    });
    await home();
    await assertExport(false);
  });

  await check('純偏好與即時外觀更新不抹掉匯入選擇', async () => {
    await page.locator('[data-appearance-panel] > summary').click();
    await page.locator('[data-appearance="theme"][value="light"]').check();
    await assertExport(true, /自訂偏好\s+1\s+項/);
    assert.equal((await download()).prefs.theme, 'light');
    await page.locator('#backup [data-file]').setInputFiles({ name: 'pending.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ format: 'lang-learn.backup', version: 1, exportedAt: 123, prefs: { grammarLines: false } })) });
    await page.locator('#backup [data-pick="preferences"]').uncheck();
    await page.evaluate(() => { window.backupChoice = document.querySelector('#backup [data-pick="preferences"]'); });
    await page.locator('[data-appearance-panel] > summary').click();
    await page.locator('[data-appearance="theme"][value="dark"]').check();
    await assertExport(false);
    assert.equal(await page.locator('#backup [data-pick="preferences"]').isChecked(), false);
    assert.equal(await page.evaluate(() => window.backupChoice === document.querySelector('#backup [data-pick="preferences"]')), true);
  });

  await check('只有回饋偏好也可匯出', async () => {
    await page.evaluate(async () => (await import('/assets/js/ui/prefs.js')).setPref('quietMode', true));
    await home();
    await assertExport(true, /自訂偏好\s+1\s+項/);
    assert.equal((await download()).prefs.quietMode, true);
  });

  await check('原有統計／逐題／單字簿／筆記摘要保留實際數量', async () => {
    await page.locator('#backup [data-file]').setInputFiles({ name: 'counts.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ format: 'lang-learn.backup', version: 1, exportedAt: 123,
        stats: { schemaVersion: 1, byScope: { 'en:words': { answered: 2, correct: 1, sessions: 1 } } },
        progress: { schemaVersion: 1, items: { 'en-w-001': { n: 2, w: 1 } } } })) });
    await page.locator('#backup [data-confirm]').click();
    await page.waitForFunction(() => document.querySelector('#backup .backup-msg').textContent.startsWith('已還原'));
    await page.evaluate(async () => {
      const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
      const { createLibraryService } = await import('/assets/js/ui/platform/library-service.js');
      const store = getLearningStore();
      const library = createLibraryService({ store });
      await library.create('測試單字簿');
      await library.saveNote('en-w-001', '測試筆記', { expectedRevision: null, epoch: (await store.ready()).dataEpoch });
    });
    await home();
    await assertExport(true, /測驗統計\s+1\s+組.*逐題紀錄\s+1\s+筆.*單字簿\s+2\s+本.*筆記\s+1\s+則/);
    const backup = await download();
    assert.equal(Object.keys(backup.learning.library.books).length, 2);
    assert.equal(Object.keys(backup.learning.library.notes).length, 1);
    assert.equal(backup.stats.byScope['en:words'].answered, 2);
    assert.equal(backup.progress.items['en-w-001'].n, 2);
  });

  for (const enabled of [false, true]) {
    await check(`只有提醒設定（enabled=${enabled}）可匯出`, async () => {
      await page.goto(origin + '/en/history.html');
      await page.locator('[data-reminder-enabled]').setChecked(enabled);
      await page.locator('[data-reminder-time]').fill('21:30');
      await page.locator('[data-reminder-save]').click();
      await page.waitForFunction(() => document.body.textContent.includes('提醒設定已保存。'));
      await home();
      await assertExport(true, /提醒設定\s+1\s+組/);
      const reminder = (await download()).learning.reminderPreferences;
      assert.equal(reminder.enabled, enabled);
      assert.equal(reminder.localTime, '21:30');
    });
  }

  for (const [name, incoming, expected, version = 1] of [
    ['hideKanji=true', { hideKanji: true }, 'kana'],
    ['hideKanji=false', { hideKanji: false }, 'show'],
    ['明確 kanjiMode 優先', { hideKanji: true, kanjiMode: 'ruby' }, 'ruby'],
    ['未指定漢字模式保留本機', { grammarLines: false }, 'ruby'],
    ['v2 內的舊 hideKanji', { hideKanji: true }, 'kana', 2],
  ]) {
    await check('舊偏好先遷移再合併：' + name, async () => {
      await page.evaluate(async () => {
        const { loadPrefs, savePrefs } = await import('/assets/js/ui/prefs.js');
        savePrefs({ ...loadPrefs(), kanjiMode: 'ruby', palette: 'forest', quietMode: true, 'daily.en.newLimit': 7 });
      });
      const prefs = await importPrefs(incoming, version);
      assert.equal(prefs.kanjiMode, expected);
      assert.equal(prefs.palette, 'forest');
      assert.equal(prefs.quietMode, true);
      assert.equal(prefs['daily.en.newLimit'], 7, '未包含在備份內的本機偏好維持合併政策');
      await page.reload();
      await page.locator('#backup [data-export]').waitFor();
      assert.equal(await page.evaluate(async () => (await import('/assets/js/ui/prefs.js')).loadPrefs().kanjiMode), expected);
    });
  }

  if (failures.length) throw new Error(failures.join('\n'));
}
