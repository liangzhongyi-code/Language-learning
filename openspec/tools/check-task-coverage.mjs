/**
 * 檢查任務清單是否逐項對應現行規格；通過只代表文件完整，不代表功能已驗證。
 * 每一組是「一份任務清單 ↔ 它負責的規格」，情境編號前綴各自獨立。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const groups = [
  {
    prefix: '[DOGS]',
    tasks: 'add-offline-study-suite/tasks.md',
    specs: [
      'add-daily-learning/specs/daily-learning.md',
      'add-offline-study-suite/specs/offline-study.md',
      'add-offline-study-suite/specs/google-backup.md',
      'add-native-app-packaging/specs/native-app.md',
    ],
  },
  {
    prefix: 'J',
    tasks: 'add-jlpt-mock-source/tasks.md',
    specs: ['add-jlpt-mock-source/specs/jlpt-mock.md'],
  },
  {
    prefix: 'R',
    tasks: 'add-jlpt-n1-reading/tasks.md',
    specs: ['add-jlpt-n1-reading/specs/jlpt-reading.md'],
  },
  {
    prefix: '[HACM]',
    tasks: 'add-cloud-sync/tasks.md',
    specs: [
      'add-cloud-sync/specs/cloud-hosting.md',
      'add-cloud-sync/specs/cloud-auth.md',
      'add-cloud-sync/specs/cloud-sync.md',
      'add-cloud-sync/specs/cloud-admin.md',
    ],
  },
];
const errors = [];
let totalIds = 0;
let totalRows = 0;
for (const { prefix, tasks, specs } of groups) {
  const ids = specs.flatMap((path) =>
    [...read('openspec/changes/' + path).matchAll(new RegExp(`^#### Scenario: (${prefix}\\d{2})\\b`, 'gm'))]
      .map((match) => match[1]));
  const rows = [...read('openspec/changes/' + tasks).matchAll(new RegExp(`^\\| (${prefix}\\d{2}) \\|`, 'gm'))].map((match) => match[1]);
  if (!ids.length) errors.push(tasks + '：沒有讀到任何規格情境。');
  for (const id of new Set(ids)) {
    if (ids.filter((value) => value === id).length !== 1) errors.push('規格重複：' + id);
    const count = rows.filter((value) => value === id).length;
    if (count !== 1) errors.push(id + ' 的任務映射數應為 1，實際為 ' + count);
  }
  for (const id of rows) if (!ids.includes(id)) errors.push('未知情境：' + id);
  totalIds += ids.length;
  totalRows += rows.length;
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log('規格情境 ' + totalIds + '／任務映射 ' + totalRows + '：完整且無重複（不是測試通過證明）。');
}
