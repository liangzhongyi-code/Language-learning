/**
 * 匯入前的撞號預檢。
 * 產檔之前先跑，省得等到 npm test 才發現，一輪要重來。
 * 用法：node precheck.mjs <rows檔>
 */
import fs from 'fs';

const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const { words } = await import('file:///D:/jimmy.lzy/IdeaProjects/lang-learn/assets/js/data/ja/words.js');

const haveT = new Set(words.map((w) => w.target));
const haveZ = new Map(words.map((w) => [w.zh, w.target]));

const t = {}, z = {};
for (const r of rows) {
  (t[r[1]] = t[r[1]] || []).push(r[0]);
  (z[r[0]] = z[r[0]] || []).push(r[1]);
}

const dupT = Object.entries(t).filter(([, v]) => v.length > 1);
const dupZ = Object.entries(z).filter(([, v]) => v.length > 1);
const hitT = rows.filter((r) => haveT.has(r[1]));
const hitZ = rows.filter((r) => haveZ.has(r[0]));

console.log(`本批 ${rows.length} 筆`);
console.log('批內 target 重複:', dupT.map(([k, v]) => `${k}=${v.join('/')}`).join('  ') || '(無)');
console.log('批內 zh 重複:', dupZ.map(([k, v]) => `${k}=${v.join('/')}`).join('  ') || '(無)');
console.log('撞現有 target:', hitT.map((r) => r[1]).join(' ') || '(無)');
console.log('撞現有 zh:', hitZ.map((r) => `${r[0]}(${r[1]} vs 既有 ${haveZ.get(r[0])})`).join('  ') || '(無)');

/* 分類覆蓋率：合併後每個分類是否都 >= 4 筆 */
const cat = {};
for (const w of words) cat[w.category] = (cat[w.category] || 0) + 1;
for (const r of rows) cat[r[4]] = (cat[r[4]] || 0) + 1;
const thin = Object.entries(cat).filter(([, n]) => n < 4);
console.log('合併後不足 4 筆的分類:', thin.map(([k, n]) => `${k}:${n}`).join('  ') || '(無)');
