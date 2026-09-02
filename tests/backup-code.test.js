/**
 * 備份代碼的編碼與解碼。
 *
 * 這條路的價值在「貼過去就能還原」，所以重點是：來回一致、
 * 貼壞了要說得出哪裡壞、通訊軟體塞進來的換行不能讓它失效。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  encodeBackupCode,
  decodeBackupCode,
  codeSizeHint,
  canCompress,
  CHAT_FRIENDLY_CHARS,
} from '../assets/js/core/backup-code.js';
import { exportPayload, parseBackup } from '../assets/js/core/backup.js';

const T0 = 1756700000000;

const SAMPLE = {
  stats: { schemaVersion: 1, byScope: { 'ja:words': { answered: 30, correct: 24, sessions: 3 } } },
  progress: { schemaVersion: 1, items: { 'ja-w-001': { n: 3, w: 1, box: 1, last: T0, due: T0 } } },
  prefs: { kanjiMode: 'ruby', kanaMode: 'both' },
};

const payload = exportPayload(SAMPLE, T0);

/* ── 來回一致 ────────────────────────────────────────────── */

test('編碼再解碼拿回一模一樣的備份', async () => {
  const code = await encodeBackupCode(payload);
  const json = await decodeBackupCode(code);
  assert.deepEqual(JSON.parse(json), payload);
});

test('解出來的東西能直接走 parseBackup，與檔案匯入是同一條路', async () => {
  const code = await encodeBackupCode(payload);
  const result = parseBackup(await decodeBackupCode(code));
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, SAMPLE);
});

test('代碼只含字母數字與 +/=，前面帶可辨識的前綴', async () => {
  const code = await encodeBackupCode(payload);
  assert.match(code, /^langlearn\d+:[A-Za-z0-9+/=]+$/);
});

test('這個環境會壓縮，而且壓縮後比不壓縮短得多', async () => {
  assert.equal(canCompress(), true, 'Node 18+ 應該有 CompressionStream');
  /* 造一份重複度高的紀錄，模擬真實資料 */
  const items = {};
  for (let i = 0; i < 500; i++) {
    items[`ja-w-${String(i).padStart(4, '0')}`] = { n: 3, w: 1, box: 2, last: T0 + i, due: T0 + i };
  }
  const big = exportPayload({ progress: { schemaVersion: 1, items } }, T0);
  const code = await encodeBackupCode(big);
  const plainChars = btoa(JSON.stringify(big)).length;
  assert.ok(code.startsWith('langlearn1:'), '有壓縮能力就該用版本 1');
  assert.ok(code.length < plainChars / 3, `壓縮後 ${code.length} 字，不壓縮 ${plainChars} 字，壓縮率不夠`);
  assert.deepEqual(JSON.parse(await decodeBackupCode(code)), big);
});

/* ── 貼過來的東西沒那麼乾淨 ──────────────────────────────── */

test('夾著換行與空白照樣解得開——通訊軟體會在長字串裡塞這些', async () => {
  const code = await encodeBackupCode(payload);
  const mangled = `  ${code.slice(0, 20)}\n${code.slice(20, 40)}  \r\n${code.slice(40)}\n`;
  assert.deepEqual(JSON.parse(await decodeBackupCode(mangled)), payload);
});

test('不壓縮的版本 0 也解得開', async () => {
  const plain = `langlearn0:${btoa(JSON.stringify(payload))}`;
  assert.deepEqual(JSON.parse(await decodeBackupCode(plain)), payload);
});

/* ── 壞代碼要說得出哪裡壞 ────────────────────────────────── */

test('空的、別人的、亂打的一律擋下，而且不動任何資料', async () => {
  await assert.rejects(() => decodeBackupCode(''), /還沒有貼上/);
  await assert.rejects(() => decodeBackupCode('   \n  '), /還沒有貼上/);
  for (const junk of ['hello', 'langlearn', 'langlearn1', 'langlearn1:', 'other1:AAAA', '{"a":1}']) {
    await assert.rejects(() => decodeBackupCode(junk), /不是本站的代碼/, `${junk} 不該被當成代碼`);
  }
});

test('少複製一段時說「不完整」，不是丟一句解碼錯誤', async () => {
  const code = await encodeBackupCode(payload);
  /* 從中間砍一段，破壞 gzip 結構 */
  const truncated = code.slice(0, code.length - 30);
  await assert.rejects(() => decodeBackupCode(truncated), /不完整|解不開/);
});

test('比自己新的版本擋下', async () => {
  await assert.rejects(() => decodeBackupCode('langlearn9:AAAA'), /較新的格式/);
});

/* ── 字數提示 ────────────────────────────────────────────── */

test('codeSizeHint：短的可以貼聊天，長的不建議', () => {
  assert.deepEqual(codeSizeHint('a'.repeat(100)), { chars: 100, chatFriendly: true });
  assert.deepEqual(codeSizeHint('a'.repeat(CHAT_FRIENDLY_CHARS)), {
    chars: CHAT_FRIENDLY_CHARS,
    chatFriendly: true,
  });
  assert.deepEqual(codeSizeHint('a'.repeat(CHAT_FRIENDLY_CHARS + 1)), {
    chars: CHAT_FRIENDLY_CHARS + 1,
    chatFriendly: false,
  });
  assert.deepEqual(codeSizeHint(''), { chars: 0, chatFriendly: false });
  assert.deepEqual(codeSizeHint(null), { chars: 0, chatFriendly: false });
});
