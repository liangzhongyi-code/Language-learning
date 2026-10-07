import assert from 'node:assert/strict';

/**
 * 真正頁面流程：每日學習作答並重開續答、單字簿建立與筆記純文字、練習頁判題與 IME、
 * 以及四個新頁面在 320／375／1280 寬度沒有整頁水平捲動。隔離 context，無使用者資料。
 */
export async function run({ page, origin }) {
  const overflow = async () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);

  await page.goto(origin + '/ja/daily.html');
  await page.locator('[data-continue]').waitFor();
  assert.match(await page.locator('.daily-summary').innerText(), /新字 5/, 'D01 首日 5 個新字');
  await page.locator('[data-continue]').click();
  await page.locator('[data-start]').click();
  await page.locator('[data-opt]').first().waitFor();
  assert.equal(await page.locator('[data-next]').isDisabled(), true, '保存前不能下一題');
  await page.keyboard.press('1');
  await page.waitForFunction(() => !document.querySelector('[data-next]').disabled);
  assert.equal(await page.locator('.backup-msg').innerText(), '已保存。');
  await page.reload();
  await page.locator('[data-continue]').waitFor();
  assert.match(await page.locator('.daily-summary').innerText(), /已完成 1/, 'D02/D11 重開後保留已提交題');
  assert.equal(await page.locator('[data-continue]').innerText(), '繼續');

  await page.goto(origin + '/ja/index.html');
  await page.locator('.today-card').waitFor();
  assert.match(await page.locator('.today-card').innerText(), /繼續今日學習/, '首頁今日卡顯示確定工作量');

  await page.goto(origin + '/ja/library.html');
  await page.locator('[data-new-name]').waitFor();
  await page.locator('[data-new-name]').fill('測試簿');
  await page.locator('[data-create]').click();
  await page.waitForFunction(() => document.querySelector('.backup-msg').textContent === '已建立單字簿。');
  await page.locator('[data-search]').fill('えき');
  await page.locator('[data-results] [data-add]').first().click();
  await page.waitForFunction(() => document.querySelector('.backup-msg').textContent === '已加入。');
  await page.locator('[data-note]').first().click();
  await page.locator('[data-note-input]').fill('<img src=x onerror=alert(1)>');
  await page.locator('[data-note-save]').click();
  await page.waitForFunction(() => document.querySelector('.backup-msg').textContent === '筆記已保存。');
  assert.equal(await page.locator('[data-note-text]').innerText(), '<img src=x onerror=alert(1)>', 'O06 筆記以純文字顯示');
  assert.equal(await page.locator('[data-note-text] img').count(), 0);

  await page.goto(origin + '/ja/practice.html');
  await page.locator('[data-start]:not([disabled])').waitFor();
  await page.locator('[data-start]').click();
  const input = page.locator('[data-input]');
  await input.waitFor();
  await input.fill('ちがう');
  await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  assert.equal(await page.locator('.feedback').count(), 0, 'O08 組字中 Enter 不送出');
  await input.press('Enter');
  await page.locator('.feedback').waitFor();
  assert.match(await page.locator('.feedback').innerText(), /答錯了/);

  for (const path of ['/ja/daily.html', '/en/practice.html', '/ja/library.html', '/en/history.html']) {
    for (const width of [320, 375, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(origin + path);
      await page.locator('#app .card').first().waitFor();
      assert.equal(await overflow(), false, `D23 ${path} 在 ${width}px 不可整頁水平捲動`);
    }
  }
}
