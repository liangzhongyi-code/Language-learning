import assert from 'node:assert/strict';

const events = (page) => page.evaluate(async () => {
  const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
  const { rows } = await getLearningStore().read(['reviewEvents', 'stats']);
  return { events: Object.values(rows.reviewEvents), stats: rows.stats['ja:kana'] };
});

const noOverflow = async (page, label) => {
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${label} ${width}px 無水平溢出`);
  }
};

/**
 * 正式頁面的五十音流程：三種模式都實際作答到結果畫面，對照表與小抄可用，紀錄寫進既有儲存。
 */
export async function run({ page, origin }) {
  /* 首頁入口 → 測驗頁，預設就是零基礎該開始的設定 */
  await page.goto(origin + '/ja/index.html');
  await page.locator('a.entry[href*="quiz.html?source=kana"]').click();
  await page.locator('[data-start]:enabled').waitFor();
  const pressed = (name) => page.locator(`[data-set="${name}"][aria-pressed="true"]`).getAttribute('data-value');
  assert.equal(await pressed('source'), 'kana');
  assert.equal(await pressed('kanaScript'), 'hiragana');
  assert.equal(await pressed('kanaDirection'), 'target2zh');
  assert.deepEqual(await page.locator('[data-kana-group][aria-pressed="true"]').evaluateAll((n) => n.map((x) => x.dataset.kanaGroup)), ['seion-1']);
  assert.equal(await page.locator('[data-set="level"]').count(), 0, '五十音沒有 JLPT 難度');
  assert.equal(await page.locator('[data-set="kanjiMode"]').count(), 0, '五十音沒有漢字設定');
  await noOverflow(page, '設定畫面');

  /* 範圍全部取消時不能開始 */
  await page.locator('[data-kana-group="seion-1"]').click();
  assert.equal(await page.locator('[data-start]').isDisabled(), true);
  await page.locator('[data-kana-group="seion-1"]').click();

  const patterns = { hiragana: /^[ぁ-ゖ]+$/, katakana: /^[ァ-ヺ]+$/, mixed: /^[ぁ-ヺ]+$/ };
  let expected = 0;
  for (const script of ['hiragana', 'katakana', 'mixed']) {
    await page.goto(`${origin}/ja/quiz.html?source=kana&script=${script}`);
    await page.locator('[data-start]:enabled').waitFor();
    assert.equal(await pressed('kanaScript'), script, '網址可指定模式');
    await page.locator('[data-start]').click();
    let wrong = 0;
    for (let i = 0; i < 10; i++) {
      await page.locator(`.progress-text:has-text("第 ${i + 1} /")`).waitFor();
      const glyph = (await page.locator('.kana-prompt').innerText()).trim();
      assert.match(glyph, patterns[script]);
      assert.equal(await page.locator('[data-opt]').count(), 4);
      assert.equal(await page.locator('.prompt .speak').count(), 0, '唸出來就是答案，作答前不給朗讀');
      const answer = await page.evaluate(async (text) => {
        const { kana } = await import('/assets/js/data/ja/kana.js');
        return kana.find((k) => k.hiragana === text || k.katakana === text).romaji;
      }, glyph);
      const texts = await page.locator('[data-opt]').evaluateAll((nodes) => nodes.map((n) => n.lastChild.textContent.trim() || n.textContent.replace(/^\s*\d\s*/, '').trim()));
      const right = texts.findIndex((t) => t === answer);
      assert.ok(right >= 0, `${glyph} 的選項要有 ${answer}：${texts}`);
      const choose = i === 0 ? (right + 1) % 4 : right;
      if (choose !== right) wrong++;
      await page.locator('[data-opt]').nth(choose).click();
      assert.equal(await page.locator('.opt.is-correct').count(), 1);
      assert.equal(await page.locator('.opt.is-wrong').count(), choose === right ? 0 : 1);
      assert.match(await page.locator('.feedback').innerText(), /平假名.*片假名.*羅馬音/s);
      await page.locator('[data-next]:enabled').waitFor();
      await page.locator('[data-next]').click();
    }
    await page.locator('.score').waitFor();
    assert.match(await page.locator('.score').innerText(), /9 \/ 10/);
    assert.equal(await page.locator('.wrong').count(), wrong);
    assert.equal(await page.locator('a[href="./kana.html"].btn').count(), 1, '結果頁可開對照表');
    expected += 10;
    const saved = await events(page);
    assert.equal(saved.events.length, expected);
    assert.equal(saved.stats.answered, expected);
  }

  /* 看羅馬音選假名 + 小抄：作答前翻過要記成提示 */
  await page.locator('[data-again]').click();
  await page.locator('[data-set="kanaDirection"][data-value="zh2target"]').click();
  await page.locator('[data-start]').click();
  await page.locator('.kana-prompt').waitFor();
  assert.match((await page.locator('.kana-prompt').innerText()).trim(), /^[a-z]+$/);
  await page.locator('[data-kana-peek] > summary').click();
  assert.equal(await page.locator('[data-kana-peek] .kana:not(.blank)').count(), 104);
  await noOverflow(page, '小抄');
  await page.locator('[data-opt]').first().click();
  await page.locator('[data-next]:enabled').waitFor();
  assert.equal(await page.locator('[data-kana-peek]').evaluate((n) => n.open), true, '作答後小抄維持展開');
  await page.locator('[data-next]').click();
  await page.locator('.progress-text:has-text("第 2 /")').waitFor();
  assert.equal(await page.locator('[data-kana-peek]').evaluate((n) => n.open), false, '換題收起來');
  await page.locator('[data-opt]').first().click();
  await page.locator('[data-next]:enabled').waitFor();
  await page.locator('[data-kana-peek] > summary').click();
  const hints = (await events(page)).events.slice().sort((a, b) => a.answeredAt - b.answeredAt).slice(-2).map((e) => e.assistance.hintUsed);
  assert.deepEqual(hints, [true, false], '作答後再翻不算提示');

  /* 重新開頁續答，小抄仍可用 */
  await page.goto(origin + '/ja/quiz.html');
  await page.locator('[data-resume-quiz]').first().click();
  await page.locator('.progress-text:has-text("第 3 /")').waitFor();
  assert.equal(await page.locator('[data-kana-peek] .kana:not(.blank)').count(), 104);

  /* 對照表頁：104 格、三種寫法、四種寬度都不溢出、可切換、深淺色文字可見 */
  await page.goto(origin + '/ja/kana.html');
  await page.locator('.kana-table').first().waitFor();
  assert.equal(await page.locator('.kana-table .kana:not(.blank)').count(), 104);
  await page.evaluate(() => document.querySelectorAll('.kana-section').forEach((node) => { node.open = true; }));
  await noOverflow(page, '對照表');
  for (const width of [320, 375, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    const clipped = await page.locator('.kana-table .kana:not(.blank)').evaluateAll((nodes) => nodes
      .filter((n) => n.scrollWidth > n.clientWidth + 1 || n.querySelector('.glyph').scrollWidth > n.clientWidth + 1).map((n) => n.textContent));
    assert.deepEqual(clipped, [], `${width}px 的格子文字不被裁切`);
  }
  await page.setViewportSize({ width: 375, height: 800 });
  const columns = await page.locator('.kana-table').first().evaluate((n) => [...n.querySelectorAll('.kana-row')][1].querySelectorAll('.kana').length);
  assert.equal(columns, 5, '手機寬度仍是五欄');
  await page.locator('.chip[data-mode="katakana"]').click();
  assert.equal(await page.locator('.kana-table .hira').count(), 0);
  await page.locator('a.btn[href*="script=mixed"]').click();
  await page.locator('[data-start]:enabled').waitFor();
  assert.equal(await pressed('kanaScript'), 'mixed');

  /* 英文沒有五十音，指定了也退回單字 */
  await page.goto(origin + '/en/quiz.html?source=kana');
  await page.locator('[data-start]:enabled').waitFor();
  assert.equal(await pressed('source'), 'words');
  assert.equal(await page.locator('[data-set="source"][data-value="kana"]').count(), 0);
}
