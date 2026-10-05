/**
 * 檢查整合任務清單是否逐項對應現行規格；通過只代表文件完整，不代表功能已驗證。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const specs = [
  'add-daily-learning/specs/daily-learning.md',
  'add-offline-study-suite/specs/offline-study.md',
  'add-offline-study-suite/specs/google-backup.md',
  'add-native-app-packaging/specs/native-app.md',
];
const ids = specs.flatMap((path) =>
  [...read('openspec/changes/' + path).matchAll(/^#### Scenario: ([DOGS]\d{2})\b/gm)]
    .map((match) => match[1]));
const taskText = read('openspec/changes/add-offline-study-suite/tasks.md');
const rows = [...taskText.matchAll(/^\| ([DOGS]\d{2}) \|/gm)].map((match) => match[1]);
const errors = [];
if (!ids.length) errors.push('沒有讀到任何規格情境。');
for (const id of new Set(ids)) {
  if (ids.filter((value) => value === id).length !== 1) errors.push('規格重複：' + id);
  const count = rows.filter((value) => value === id).length;
  if (count !== 1) errors.push(id + ' 的任務映射數應為 1，實際為 ' + count);
}
for (const id of rows) if (!ids.includes(id)) errors.push('未知情境：' + id);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log('規格情境 ' + ids.length + '／任務映射 ' + rows.length + '：完整且無重複（不是測試通過證明）。');
}
