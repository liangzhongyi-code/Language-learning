/**
 * 把 [中文, 目標語, 假名讀音, 詞性, 分類] 的元組表輸出成日文批次檔，
 * romaji 欄位由 kana-romaji.mjs 自動產生，不手打。
 *
 * 用法：node gen-ja.mjs <rows檔> <輸出檔> <START> <LEVEL> <標題註解檔>
 */
import fs from 'fs';
import { toRomaji } from 'file:///D:/jimmy.lzy/IdeaProjects/lang-learn/openspec/tools/kana-romaji.mjs';

const [rowsFile, outFile, start, level, headFile] = process.argv.slice(2);
const rows = JSON.parse(fs.readFileSync(rowsFile, 'utf8'));
const head = fs.readFileSync(headFile, 'utf8');

/**
 * 單引號字串裡的單引號要跳脫。
 * ん 接母音時羅馬拼音會產生隔音符（きんようび → kin'youbi），
 * 不跳脫的話那一行的字串會被截斷成語法錯誤。
 */
const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const lines = rows.map(([zh, target, reading, pos, category]) => {
  const romaji = toRomaji(reading);
  return `  [${[zh, target, reading, romaji, pos, category].map(q).join(', ')}],`;
});

const body = `${head}
/**
 * [中文, 日文, 假名讀音, 羅馬拼音, 詞性, 主題分類]
 * romaji 由 openspec/tools/kana-romaji.mjs 產生，不手打
 */
const rows = [
${lines.join('\n')}
];

/**
 * 這一批的難度
 */
const LEVEL = ${level};

/**
 * 這一批的起始流水號
 */
const START = ${start};

export const words = rows.map(([zh, target, reading, romaji, pos, category], i) => ({
  id: \`ja-w-\${String(START + i).padStart(3, '0')}\`,
  zh,
  target,
  reading,
  romaji,
  pos,
  category,
  level: LEVEL,
}));
`;

fs.writeFileSync(outFile, body, 'utf8');
console.log(`寫入 ${outFile}：${rows.length} 筆，id ${start} ～ ${Number(start) + rows.length - 1}`);
