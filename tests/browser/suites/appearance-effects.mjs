import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * 解碼 Chromium PNG，直接比較截圖 RGB；不以 computed background 當作可見證據。
 */
export function pixels(png) {
  let width, height, channels;
  const chunks = [];
  for (let at = 8; at < png.length;) {
    const size = png.readUInt32BE(at), type = png.toString('ascii', at + 4, at + 8);
    const data = png.subarray(at + 8, at + 8 + size);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      assert.equal(data[8], 8); assert.equal(data[12], 0);
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      assert.ok(channels, '只接受 RGB/RGBA PNG');
    }
    if (type === 'IDAT') chunks.push(data);
    at += size + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)), stride = width * channels;
  const data = Buffer.alloc(height * stride);
  let at = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[at++];
    assert.ok(filter <= 4, 'PNG filter 必須介於 0–4');
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x;
      const a = x >= channels ? data[i - channels] : 0;
      const b = y ? data[i - stride] : 0;
      const c = y && x >= channels ? data[i - stride - channels] : 0;
      let prediction = 0;
      if (filter === 1) prediction = a;
      else if (filter === 2) prediction = b;
      else if (filter === 3) prediction = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        prediction = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      data[i] = (raw[at++] + prediction) & 255;
    }
  }
  return { width, height, channels, data };
}

/**
 * 以 byte mask 排除前景矩形，避免每個像素反覆掃描矩形清單。
 */
function exclusionMask(width, height, excluded) {
  const mask = new Uint8Array(width * height);
  for (const r of excluded) {
    const left = Math.max(0, Math.ceil(r.left)), right = Math.min(width, Math.ceil(r.right));
    const top = Math.max(0, Math.ceil(r.top)), bottom = Math.min(height, Math.ceil(r.bottom));
    if (right <= left || bottom <= top) continue;
    for (let y = top; y < bottom; y++) mask.fill(1, y * width + left, y * width + right);
  }
  return mask;
}

/**
 * 只計算真正露出的背景區域，排除卡片、文字、導覽與陰影周邊。
 */
export function difference(first, second, excluded = []) {
  const a = pixels(first), b = pixels(second);
  assert.equal(a.width, b.width); assert.equal(a.height, b.height);
  const mask = exclusionMask(a.width, a.height, excluded);
  let max = 0, visible = 0, changed = 0, sum = 0, sampled = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) continue;
    const ai = i * a.channels, bi = i * b.channels;
    const delta = Math.max(Math.abs(a.data[ai] - b.data[bi]),
      Math.abs(a.data[ai + 1] - b.data[bi + 1]), Math.abs(a.data[ai + 2] - b.data[bi + 2]));
    max = Math.max(max, delta); sum += delta; sampled++;
    if (delta) changed++;
    if (delta >= 12) visible++;
  }
  assert.ok(sampled > 0, '必須存在未被前景遮住的背景取樣區域');
  return { max, visible, changed, mean: sum / sampled, sampled };
}

/**
 * 檢查純色確實存在於露出的背景；固定左下角可能落在測驗卡片陰影，不能當底色。
 */
function paletteSample(png, color, excluded) {
  const image = pixels(png), mask = exclusionMask(image.width, image.height, excluded);
  let distance = Infinity, sample = -1;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) continue;
    const at = i * image.channels;
    const delta = Math.max(Math.abs(image.data[at] - color[0]),
      Math.abs(image.data[at + 1] - color[1]), Math.abs(image.data[at + 2] - color[2]));
    if (delta < distance) { distance = delta; sample = i; }
    if (delta === 0) break;
  }
  assert.ok(sample >= 0, '純色必須在背景區域取樣');
  const at = sample * image.channels;
  return { actualColor: [...image.data.subarray(at, at + 3)],
    position: { x: sample % image.width, y: Math.floor(sample / image.width) } };
}

export async function configure(page, options) {
  await page.evaluate(async (values) => {
    const { setAppearance } = await import('/assets/js/ui/appearance.js');
    for (const [key, value] of Object.entries(values)) setAppearance(key, value);
    document.querySelector('[data-appearance-panel]').open = false;
    for (const animation of document.getAnimations()) {
      if (animation.animationName === 'ambient-breathe') { animation.pause(); animation.currentTime = 0; }
      else animation.finish();
    }
    await document.fonts.ready;
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  }, options);
}

export async function backgroundExclusions(page) {
  return page.evaluate(() => [...document.querySelectorAll('.topbar,.page-head,.card,.entry,.sec-head,.foot,h2,.backup-title,#notice')].map((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left - 4, right: r.right + 4, top: r.top - 4, bottom: r.bottom + 4 };
  }));
}

/**
 * 新 context、loopback fixture、假 prefs。classic 深淺三寬＋其他配色深淺 1280，
 * 共 24 組真正像素量測；其餘 24 組僅檢查 computed style，分開回報。
 * 手動降低特效移除光點；OS 減少動態保留靜態光點，手動設定優先。
 */
export async function run({ page, origin }) {
  const failures = [], records = [], computedRecords = [];
  const started = Date.now();
  const caseFilter = process.env.APPEARANCE_CASE_FILTER ? new RegExp(process.env.APPEARANCE_CASE_FILTER) : null;
  const check = (condition, message) => { if (!condition) failures.push(message); };
  const directory = process.env.APPEARANCE_EVIDENCE_DIR;
  if (directory) await mkdir(directory, { recursive: true });
  for (const path of ['/index.html', '/ja/quiz.html']) for (const width of [320, 375, 1280]) {
    if (caseFilter && !['dark', 'light'].some((theme) => ['classic', 'midnight', 'forest', 'warm']
      .some((palette) => caseFilter.test(`${path} ${width} ${theme} ${palette}`)))) continue;
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(origin + path);
    await page.locator('[data-appearance-panel]').waitFor();
    if (path.includes('quiz')) await page.locator('[data-start]:not([disabled])').waitFor();
    else await page.locator('#backup [data-code]').waitFor();
    const excluded = await backgroundExclusions(page);
    const domCount = await page.locator('body *').count();
    for (const theme of ['dark', 'light']) for (const palette of ['classic', 'midnight', 'forest', 'warm']) {
      const label = `${path} ${width} ${theme} ${palette}`;
      if (caseFilter && !caseFilter.test(label)) continue;
      if (width !== 1280 && palette !== 'classic') {
        const states = [];
        for (const mode of ['normal', 'user', 'os', 'both']) {
          await page.emulateMedia({ reducedMotion: mode === 'os' || mode === 'both' ? 'reduce' : 'no-preference' });
          await configure(page, { theme, palette, background: 'dust', reducedEffects: mode === 'user' || mode === 'both' });
          const effects = await page.evaluate(() => {
            const dots = getComputedStyle(document.body, '::after');
            return { display: dots.display, opacity: dots.opacity, animation: dots.animationName,
              glowOpacity: getComputedStyle(document.body, '::before').opacity,
              blur: getComputedStyle(document.querySelector('.topbar')).backdropFilter, pointer: dots.pointerEvents };
          });
          check(effects.pointer === 'none', `${label} ${mode}: 背景不攔截點擊`);
          if (mode === 'normal') check(effects.display !== 'none' && effects.animation === 'ambient-breathe', `${label}: 正常光點有動畫`);
          else {
            check(effects.animation === 'none' && effects.blur === 'none' && effects.glowOpacity === '0.35', `${label} ${mode}: 降低柔光／動畫／模糊`);
            check(mode === 'os' ? effects.display !== 'none' && effects.opacity === '0.72' : effects.display === 'none', `${label} ${mode}: 手動隱藏優先，OS 保留靜態光點`);
          }
          states.push({ mode, effects });
        }
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await configure(page, { reducedEffects: false });
        check(await page.evaluate(() => getComputedStyle(document.body, '::after').animationName) === 'ambient-breathe', `${label}: 恢復動畫`);
        check(await page.locator('body *').count() === domCount && await page.locator('canvas').count() === 0, `${label}: 不新增 DOM／Canvas`);
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: 不可水平溢出`);
        computedRecords.push({ label, states });
        continue;
      }
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await configure(page, { theme, palette, reducedEffects: false, background: 'plain' });
      const plain = await page.screenshot();
      const color = await page.evaluate(() => getComputedStyle(document.body).backgroundColor.match(/\d+/g).map(Number));
      const { actualColor, position: colorSample } = paletteSample(plain, color, excluded);
      check(actualColor.every((c, i) => Math.abs(c - color[i]) <= 2), `${label}: 純色實際像素必須符合 palette 底色`);
      await configure(page, { background: 'aurora' });
      const aurora = await page.screenshot();
      await configure(page, { background: 'dust' });
      const dust = await page.screenshot();
      const glow = difference(plain, aurora, excluded), dots = difference(aurora, dust, excluded);
      check(glow.max >= 5 && glow.changed > 100, `${label}: 柔光應實際可見 ${JSON.stringify(glow)}`);
      check(dots.max >= 12 && dots.visible >= 4, `${label}: 微塵最淡相位應有至少 4 個可見像素 ${JSON.stringify(dots)}`);
      const record = { label, color, actualColor, colorSample, glow, dots, reduced: {} };
      for (const mode of ['user', 'os']) {
        await page.emulateMedia({ reducedMotion: mode === 'os' ? 'reduce' : 'no-preference' });
        await configure(page, { reducedEffects: mode === 'user', background: 'plain' });
        const reducedPlain = await page.screenshot();
        await configure(page, { background: 'aurora' });
        const reducedAurora = await page.screenshot();
        await configure(page, { background: 'dust' });
        const reducedDust = await page.screenshot();
        const reducedGlow = difference(reducedPlain, reducedAurora, excluded);
        const reducedDots = difference(reducedAurora, reducedDust, excluded);
        const effects = await page.evaluate(() => ({
          animation: getComputedStyle(document.body, '::after').animationName,
          blur: getComputedStyle(document.querySelector('.topbar')).backdropFilter,
          pointer: getComputedStyle(document.body, '::after').pointerEvents,
          display: getComputedStyle(document.body, '::after').display,
          opacity: getComputedStyle(document.body, '::after').opacity,
          glowOpacity: getComputedStyle(document.body, '::before').opacity,
        }));
        check(mode === 'user' ? reducedDots.max === 0 && reducedDots.changed === 0
          : reducedDots.max >= 12 && reducedDots.visible >= 4,
        `${label} ${mode}: ${mode === 'user' ? '手動降低特效不留光點' : 'OS 保留靜態光點'} ${JSON.stringify(reducedDots)}`);
        check(effects.glowOpacity === '0.35' && (mode === 'user' ? effects.display === 'none' : effects.display !== 'none' && effects.opacity === '0.72'), `${label} ${mode}: 降低柔光並符合光點模式`);
        check(reducedGlow.mean < glow.mean * 0.75, `${label} ${mode}: 背景柔光必須實際降低強度`);
        check(effects.animation === 'none' && effects.blur === 'none' && effects.pointer === 'none', `${label} ${mode}: 關閉動畫／模糊且背景不攔截點擊`);
        if (palette === 'classic') {
          const stationary = await page.screenshot();
          check(difference(reducedDust, stationary, excluded).max === 0, `${label} ${mode}: 靜態點光像素不得隨時間改變`);
        }
        record.reduced[mode] = { glow: reducedGlow, dots: reducedDots, effects };
        if (directory && width === 1280 && palette === 'classic') {
          await writeFile(join(directory, `${path.includes('quiz') ? 'quiz' : 'home'}-${theme}-${mode}.png`), reducedDust);
        }
      }
      await configure(page, { reducedEffects: true });
      check(await page.evaluate(() => getComputedStyle(document.body, '::after').display) === 'none', `${label}: OS 與手動同時啟用時手動隱藏優先`);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await configure(page, { reducedEffects: false, background: 'dust' });
      check((await page.evaluate(() => getComputedStyle(document.body, '::after').animationName)) === 'ambient-breathe', `${label}: 系統恢復後重啟原動畫`);
      if (palette === 'classic') {
        await page.evaluate(() => {
          for (const animation of document.getAnimations()) if (animation.animationName === 'ambient-breathe') animation.currentTime = 12000;
        });
        const peak = difference(aurora, await page.screenshot(), excluded);
        check(peak.max >= dots.max && peak.visible >= dots.visible, `${label}: 呼吸最亮相位仍可見`);
        record.peak = peak;
      }
      check(await page.locator('body *').count() === domCount && await page.locator('canvas').count() === 0, `${label}: 不新增粒子 DOM／Canvas`);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: 不可水平溢出`);
      if (path.includes('quiz')) {
        check(await page.locator('#app .card').first().evaluate((el) => /^rgb\(/.test(getComputedStyle(el).backgroundColor)), `${label}: 測驗卡片維持實心`);
      }
      if (directory && width === 1280 && palette === 'classic') {
        for (const [name, png] of Object.entries({ plain, aurora, dust })) await writeFile(join(directory, `${path.includes('quiz') ? 'quiz' : 'home'}-${theme}-${name}.png`), png);
      }
      records.push(record);
    }
    await page.locator('.appearance-toggle').click();
    check((await page.locator('.appearance-note').first().textContent()).includes('降低柔光強度'), `${path} ${width}: 手動降低特效提示說明柔光`);
    check((await page.locator('[data-system-effects]').textContent()).includes('保留靜態微塵'), `${path} ${width}: OS 提示區分靜態微塵`);
    await page.locator('[data-appearance="reducedEffects"]').check();
    await page.keyboard.press('Escape');
    check(await page.locator('.appearance-toggle').evaluate((el) => el === document.activeElement), `${path} ${width}: Escape 恢復焦點`);
    if (path.includes('quiz')) {
      await page.locator('[data-start]').click();
      await page.locator('[data-opt]').first().click();
      await page.locator('.feedback').waitFor();
    } else {
      await page.locator('a.entry[href="./ja/index.html"]').click();
      check(new URL(page.url()).pathname === '/ja/index.html', `首頁 ${width}: 卡片連結可互動`);
    }
    console.log(`appearance-effects ${path} ${width}: ${records.filter((r) => r.label.startsWith(`${path} ${width} `)).length} 組像素／${computedRecords.filter((r) => r.label.startsWith(`${path} ${width} `)).length} 組 computed`);
  }
  const elapsedMs = Date.now() - started;
  assert.ok(records.length + computedRecords.length > 0, '案例篩選不可空跑');
  if (directory) await writeFile(join(directory, 'pixels.json'), JSON.stringify({ records, computedRecords, elapsedMs, caseFilter: caseFilter?.source ?? null, failures }, null, 2));
  console.log(JSON.stringify({ pixelCases: records.length, computedCases: computedRecords.length, elapsedMs, failures: failures.length, first: records[0] }));
  assert.equal(failures.length, 0, failures.slice(0, 12).join('\n'));
}
