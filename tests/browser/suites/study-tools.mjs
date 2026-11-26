import assert from 'node:assert/strict';

const noOverflow = async (page, label) => {
  for (const width of [320, 375, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${label} ${width}px 無水平溢出`);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
};

/**
 * 假的語音辨識與錄音：測試不碰真的麥克風，也不把聲音送到任何地方。
 * 辨識固定回 window.__heard，錄音停止時給一小段假的音訊資料。
 */
const FAKE_MEDIA = () => {
  window.__heard = ['学校'];
  window.webkitSpeechRecognition = class {
    start() {
      setTimeout(() => {
        this.onresult?.({ results: [window.__heard.map((transcript) => ({ transcript }))] });
        this.onend?.();
      }, 50);
    }
    stop() { this.onend?.(); }
    abort() {}
  };
  /* 新版 Chromium 也有不加前綴的 SpeechRecognition，兩個都換掉 */
  window.SpeechRecognition = window.webkitSpeechRecognition;
  const track = { stop() {} };
  navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [track] });
  window.MediaRecorder = class extends EventTarget {
    constructor() { super(); this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      const data = new Event('dataavailable');
      data.data = new Blob(['x'], { type: 'audio/webm' });
      this.dispatchEvent(data);
      this.dispatchEvent(new Event('stop'));
    }
  };
};

/**
 * 漢字表、閱讀頁、文法點、跟讀，以及漢字與文法兩個測驗題源。
 */
export async function run({ page, origin }) {
  await page.addInitScript(FAKE_MEDIA);

  /* ── 漢字表 ── */
  await page.goto(origin + '/ja/kanji.html');
  await page.locator('.kanji-cell').first().waitFor();
  const total = await page.locator('.kanji-cell').count();
  assert.ok(total >= 100);
  assert.ok(await page.locator('nav a[href="./kanji.html"]').count() >= 1, '導覽列有漢字');
  await page.locator('.kanji-cell', { hasText: '学' }).first().click();
  const detail = page.locator('.kanji-detail');
  assert.match(await detail.innerText(), /學[\s\S]*ガク[\s\S]*学校/);
  assert.equal(await detail.locator('.speak').first().getAttribute('data-speak'), 'がっこう');
  await noOverflow(page, '漢字表');
  await page.locator('[data-scope="diff"]').click();
  const diffCount = await page.locator('.kanji-cell').count();
  assert.equal(diffCount, await page.locator('.kanji-cell.is-diff').count());
  assert.ok(diffCount >= 7 && diffCount < total);

  /* ── 跟讀：第一次先問要不要用辨識；選了之後辨識結果與錄音都看得到 ── */
  await page.locator('.kanji-detail .shadow-btn').first().click();
  const panel = page.locator('.shadow-panel');
  assert.match(await panel.innerText(), /Google/);
  assert.equal(await panel.locator('[data-shadow-rec]').count(), 0, '還沒選之前不能開始');
  await panel.locator('[data-shadow-mode="recognize"]').click();
  await panel.locator('[data-shadow-rec]').click();
  await panel.locator('.shadow-verdict').waitFor();
  assert.match(await panel.locator('.shadow-verdict').getAttribute('class'), /is-good/);
  await panel.locator('[data-shadow-rec]').click();
  await panel.locator('.shadow-verdict').waitFor();
  await panel.locator('[data-shadow-mine]:not([hidden])').waitFor();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('lang-learn.shadow.v1')).mode), 'recognize');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('lang-learn.prefs.v1') || '{}').shadow), undefined, '跟讀設定不寫進偏好');
  await panel.locator('[data-shadow-mode="record"]').click();
  assert.match(await page.locator('.shadow-switch').innerText(), /只錄音/);

  /* ── 閱讀頁 ── */
  await page.goto(origin + '/ja/reading.html');
  await page.locator('[data-passage]').first().waitFor();
  assert.equal(await page.locator('[data-passage]').count(), 8);
  await page.locator('[data-passage="ja-r-001"]').click();
  await page.locator('.rd-sentence').first().waitFor();
  assert.equal(await page.locator('.rd-sentence').count(), 7);
  assert.equal(await page.locator('.rd-sentence .speak').first().getAttribute('data-speak'), 'たなかさんはまいあさろくじにおきます。');
  await page.locator('.rd-word[data-chunk="出"]').first().click();
  assert.match(await page.locator('.rd-lookup').innerText(), /出る[\s\S]*でる/);
  await page.locator('.rd-word[data-chunk="十分"]').first().click();
  assert.match(await page.locator('.rd-lookup').innerText(), /じゅっぷん[\s\S]*沒有這個詞[\s\S]*十/);
  assert.equal(await page.locator('.rd-lookup').count(), 1, '同時只開一個查詢');
  assert.ok(await page.locator('.rd-text rt').first().isVisible());
  await page.locator('[data-ruby]').click();
  assert.equal(await page.locator('.rd-text rt').first().isVisible(), false, '關掉標假名');
  await noOverflow(page, '閱讀頁');
  await page.locator('[data-back]').click();
  await page.locator('[data-passage]').first().waitFor();

  /* ── 文法點 ── */
  await page.goto(origin + '/ja/grammar.html');
  await page.locator('.gp-wrap').waitFor();
  assert.equal(await page.locator('.gp-wrap').evaluate((n) => n.open), false, '預設收合，不把句型拆解推出畫面');
  await page.goto(origin + '/ja/grammar.html#points');
  await page.reload();
  await page.locator('.gp-wrap[open] .gp-point').first().waitFor();
  assert.ok(await page.locator('.gp-point').count() >= 30);
  await page.locator('.gp-point > summary').first().click();
  assert.ok(await page.locator('.gp-point[open] .gp-example .shadow-btn').count() >= 2);
  await noOverflow(page, '文法頁');

  /* ── 測驗：漢字讀音 ── */
  const pressed = (name) => page.locator(`[data-set="${name}"][aria-pressed="true"]`).getAttribute('data-value');
  await page.goto(origin + '/ja/quiz.html?source=kanji&scope=diff');
  await page.locator('[data-start]:enabled').waitFor();
  assert.equal(await pressed('source'), 'kanji');
  assert.equal(await pressed('kanjiScope'), 'diff');
  assert.equal(await page.locator('[data-set="level"]').count(), 0);
  assert.equal(await page.locator('[data-set="kanjiMode"]').count(), 0);
  await page.locator('[data-start]').click();
  const kanjiAnswer = (prompt) => page.evaluate(async (text) => {
    const { kanji } = await import('/assets/js/data/ja/kanji.js');
    const { kanjiReadingSet } = await import('/assets/js/core/kanji-quiz.js');
    const k = kanji.find((x) => x.char === text);
    return kanjiReadingSet(k);
  }, prompt);
  const optionTexts = () => page.locator('[data-opt]').evaluateAll((nodes) => nodes.map((n) => n.lastChild.textContent.trim() || n.textContent.replace(/^\s*\d\s*/, '').trim()));
  const rounds = Math.min(diffCount, 10);
  for (let i = 0; i < rounds; i++) {
    await page.locator(`.progress-text:has-text("第 ${i + 1} /")`).waitFor();
    assert.match(await page.locator('.progress-text').innerText(), /漢字讀音/);
    const prompt = (await page.locator('.kana-prompt').innerText()).trim();
    const right = (await optionTexts()).indexOf(await kanjiAnswer(prompt));
    assert.ok(right >= 0, `${prompt} 的選項沒有正解`);
    await page.locator('[data-opt]').nth(right).click();
    assert.match(await page.locator('.feedback').innerText(), /繁體寫成/);
    await page.locator('[data-next]:enabled').waitFor();
    await page.locator('[data-next]').click();
  }
  await page.locator('.score').waitFor();
  assert.equal(await page.locator('a[href="./kanji.html"].btn').count(), 1);

  /* ── 測驗：文法 ── */
  await page.goto(origin + '/ja/quiz.html?source=grammar');
  await page.locator('[data-start]:enabled').waitFor();
  assert.equal(await pressed('source'), 'grammar');
  await page.locator('[data-start]').click();
  await page.locator('.grammar-prompt').waitFor();
  assert.ok((await page.locator('.grammar-prompt').innerText()).includes('＿＿'));
  assert.doesNotMatch(await page.locator('.progress-text').innerText(), /〜/, '標籤不能洩漏文法點名稱');
  await noOverflow(page, '文法題');
  await page.locator('[data-opt]').first().click();
  await page.locator('[data-next]:enabled').waitFor();
  assert.match(await page.locator('.feedback').innerText(), /（.+）/);
  const saved = await page.evaluate(async () => {
    const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
    const { rows } = await getLearningStore().read(['reviewEvents']);
    return Object.values(rows.reviewEvents).map((e) => e.sourceId);
  });
  assert.equal(saved.filter((id) => /^ja-kanji-/.test(id)).length, rounds);
  assert.equal(saved.filter((id) => /^ja-g-/.test(id)).length, 1);
}
