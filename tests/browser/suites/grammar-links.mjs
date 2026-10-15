import assert from 'node:assert/strict';

/**
 * 文法頁連接線只替畫面附近的卡片畫：看得到的卡片線條正確（數量、端點、顏色），
 * 畫面外的卡片捲到才畫；篩選、開關、改寬度、換配色後仍正確。教學頁示範句沿用同一套上色。
 */
export async function run({ page, origin }) {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto(`${origin}/ja/grammar.html`);
  await page.evaluate(() => localStorage.removeItem('lang-learn.prefs.v1'));
  await page.reload();
  await page.locator('.gram-list .card').first().waitFor();

  /**
   * 量一張卡：應有的線數、已畫的線數、每條線起點與上排色塊中心的最大誤差、線的實際顏色與角色色是否相同。
   */
  const inspect = (index) => page.evaluate((i) => {
    const card = document.querySelectorAll('.gram-list .card')[i];
    const gram = card.querySelector('.gram');
    const box = gram.querySelector('.gap-mid').getBoundingClientRect();
    const tops = [...gram.querySelectorAll('.row[data-row="zh"] .blk')]
      .filter((blk) => gram.querySelector(`.row[data-row="target"] .blk[data-k="${blk.dataset.k}"]`));
    const paths = [...gram.querySelectorAll('.gap-mid path')];
    let drift = 0;
    let colorsMatch = paths.length === tops.length;
    paths.forEach((path, n) => {
      const [x, y] = path.getAttribute('d').slice(1).split(' ')[0].split(',').map(Number);
      const r = tops[n].getBoundingClientRect();
      drift = Math.max(drift, Math.abs(x - (r.left + r.width / 2 - box.left)), Math.abs(y - (r.bottom - box.top)));
      colorsMatch &&= getComputedStyle(path).stroke === getComputedStyle(tops[n]).borderTopColor;
    });
    return { expected: tops.length, drawn: paths.length, drift, colorsMatch,
      dashed: paths.filter((path) => getComputedStyle(path).strokeDasharray !== 'none').length,
      moved: tops.filter((blk) => blk.classList.contains('moved')).length,
      cv: getComputedStyle(card).contentVisibility };
  }, index);
  /**
   * 反覆量到條件成立（最多 5 秒），回傳最後一次結果供失敗訊息使用。
   */
  const settle = async (index, ok) => {
    let result;
    for (let i = 0; i < 50; i++) {
      result = await inspect(index);
      if (ok(result)) return result;
      await page.waitForTimeout(100);
    }
    return result;
  };
  /* 先畫第一個畫面的卡片，其餘分批補上；補完前清單標 aria-busy */
  const total = await page.evaluate(() => Number(document.querySelector('[data-role="count"]').textContent.match(/\d+/)[0]));
  await page.waitForFunction(() => !document.querySelector('.gram-list').hasAttribute('aria-busy'));
  const cardCount = await page.locator('.gram-list .card').count();
  assert.ok(total > 100 && cardCount === total, `文法頁應補齊全部句子（${cardCount}/${total}）`);
  assert.equal(await page.evaluate(() => new Set([...document.querySelectorAll('.gram-list .card .meta')].map((m) => m.textContent)).size), total, '分批補上的卡片不重複');

  await page.waitForFunction(() => document.querySelector('.gram-list .card .gap-mid path'));
  let first = await inspect(0);
  assert.ok(first.expected > 0 && first.drawn === first.expected, `第一張卡線數 ${first.drawn}/${first.expected}`);
  assert.ok(first.drift < 1, `線端點偏離色塊中心 ${first.drift}px`);
  assert.ok(first.colorsMatch, '線色應與對應色塊同色');
  assert.equal(first.dashed, first.moved, '搬動的區塊用虛線');
  assert.equal(first.cv, 'auto', '畫面外的卡片交給瀏覽器略過排版');

  const last = cardCount - 1;
  assert.equal((await inspect(last)).drawn, 0, '畫面外的卡片不先畫線');
  await page.locator('.gram-list .card').nth(last).scrollIntoViewIfNeeded();
  await page.waitForFunction((i) => document.querySelectorAll('.gram-list .card')[i].querySelector('.gap-mid path'), last);
  const end = await inspect(last);
  assert.ok(end.drawn === end.expected && end.drift < 1 && end.colorsMatch, `捲到最後一張後線條正確：${JSON.stringify(end)}`);

  /* 改寬度：色塊換位置，看得到的卡片重畫後端點仍貼齊（重畫有 120ms 去抖動，等它穩定） */
  await page.setViewportSize({ width: 380, height: 800 });
  const narrow = await settle(last, (r) => r.drawn === r.expected && r.drift < 1);
  assert.ok(narrow.drawn === narrow.expected && narrow.drift < 1, `改寬度後端點仍貼齊色塊：${JSON.stringify(narrow)}`);

  /* 捲回頂端：寬度改變時不在畫面上的卡片，捲到時以新寬度重畫 */
  await page.evaluate(() => window.scrollTo(0, 0));
  first = await settle(0, (r) => r.drawn === r.expected && r.drift < 1);
  assert.ok(first.drawn === first.expected && first.drift < 1, `捲回頂端後以新寬度重畫：${JSON.stringify(first)}`);
  await page.setViewportSize({ width: 1000, height: 800 });
  first = await settle(0, (r) => r.drawn === r.expected && r.drift < 1);

  /* 換配色：線色由 CSS 決定，跟著變，不需重畫（色塊邊框有轉場動畫，等它結束） */
  const before = await page.locator('.gram-list .card .gap-mid path').first().evaluate((path) => getComputedStyle(path).stroke);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; document.documentElement.dataset.palette = 'forest'; });
  assert.ok((await settle(0, (r) => r.colorsMatch)).colorsMatch, '換配色後線色仍與色塊相同');
  const after = await page.locator('.gram-list .card .gap-mid path').first().evaluate((path) => getComputedStyle(path).stroke);
  assert.notEqual(after, before, '換配色後線色應改變');

  /* 關掉再打開連接線 */
  await page.locator('[data-role="lines"]').uncheck();
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('no-lines')), true);
  await page.locator('[data-role="lines"]').check();
  await page.waitForFunction(() => {
    const path = document.querySelector('.gram-list .card .gap-mid path');
    return path && getComputedStyle(path.closest('svg')).display !== 'none';
  });
  first = await inspect(0);
  assert.ok(first.drawn === first.expected && first.drift < 1, `重新打開連接線後正確：${JSON.stringify(first)}`);

  /* 篩選後新的一批卡片同樣補上線 */
  await page.locator('.chips .chip').nth(1).click();
  await page.waitForFunction(() => document.querySelector('.gram-list .card .gap-mid path'));
  first = await inspect(0);
  assert.ok(first.drawn === first.expected && first.drift < 1 && first.colorsMatch, `篩選後第一張卡正確：${JSON.stringify(first)}`);

  /* 分批補卡途中換篩選：舊批次作廢，只留新篩選的卡片且不重複 */
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 20 });
  await page.reload();
  await page.locator('.gram-list .card').first().waitFor();
  const chip = page.locator('.chips .chip').nth(2);
  const expected = Number(await chip.locator('.n').innerText());
  /* 在同一段頁面腳本內確認仍在補卡並點擊，避免自動化工具等待期間批次已補完 */
  const clickedWhileBusy = await page.evaluate(() => {
    const busy = document.querySelector('.gram-list').getAttribute('aria-busy') === 'true';
    document.querySelectorAll('.chips .chip')[2].click();
    return busy;
  });
  assert.ok(clickedWhileBusy, '前置條件：點擊時仍在分批補卡');
  await page.waitForFunction(() => !document.querySelector('.gram-list').hasAttribute('aria-busy'), null, { timeout: 30000 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await page.waitForTimeout(300);
  const filtered = await page.evaluate(() => [...document.querySelectorAll('.gram-list .card .meta')].map((m) => m.textContent));
  assert.equal(filtered.length, expected, `換篩選後卡片數 ${filtered.length}/${expected}`);
  assert.equal(new Set(filtered).size, expected, '換篩選後卡片不重複');
  assert.equal(new Set(filtered.map((text) => text.split(' · ')[1])).size, 1, '只留下所選句型的卡片');

  /* 教學頁示範句：同一套 CSS 上色 */
  await page.goto(`${origin}/help.html`);
  await page.waitForFunction(() => document.querySelector('.gap-mid path'));
  const help = await page.evaluate(() => {
    const top = [...document.querySelectorAll('[data-row="zh"] .blk')];
    const paths = [...document.querySelectorAll('.gap-mid path')];
    return paths.length === top.length && paths.every((path, n) => getComputedStyle(path).stroke === getComputedStyle(top[n]).borderTopColor);
  });
  assert.ok(help, '教學頁示範句線色應與色塊相同');
  await page.evaluate(() => localStorage.removeItem('lang-learn.prefs.v1'));
}
