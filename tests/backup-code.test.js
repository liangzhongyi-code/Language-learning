/**
 * 備份代碼的編碼與解碼。
 *
 * 這條路的價值在「貼過去就能還原」，所以重點是：來回一致、
 * 貼壞了要說得出哪裡壞、通訊軟體塞進來的換行不能讓它失效。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';

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
  /* 500 筆實測約 9.5 倍，門檻留一半餘裕——退化到 3 倍以下就該被抓到 */
  assert.ok(code.length < plainChars / 6, `壓縮後 ${code.length} 字，不壓縮 ${plainChars} 字，壓縮率不夠`);
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

/**
 * 截斷會走到兩條不同的錯誤路徑，要分開釘住：
 *   砍掉的字數 ≡ 3 (mod 4) 時 base64 本體長度 mod 4 == 1，atob 直接拒絕 → 「少複製了一段」；
 *   其他長度 atob 容忍（缺 padding），進到 gzip 才發現壞了 → 「解不開」。
 * 原本用 /不完整|解不開/ 一條吃兩邊——但「解不開」那句本身就含「不完整」三個字，
 * 那個正則對兩條訊息都為真，等於什麼都沒測到。
 */
test('少複製一段（長度 mod 4 == 1）：base64 就擋下，說「少複製了一段」', async () => {
  const code = await encodeBackupCode(payload);
  const truncated = code.slice(0, code.length - 3);
  await assert.rejects(() => decodeBackupCode(truncated), /少複製了一段/);
  await assert.rejects(() => decodeBackupCode(truncated), (e) => !/解不開/.test(e.message));
});

test('砍掉一大段：base64 容忍，gzip 才發現壞了，說「解不開」', async () => {
  const code = await encodeBackupCode(payload);
  const truncated = code.slice(0, code.length - 30);
  await assert.rejects(() => decodeBackupCode(truncated), /解不開/);
});

test('前後夾著說明文字、程式碼圍欄、句號，都抽得出來', async () => {
  const code = await encodeBackupCode(payload);
  for (const wrapped of [
    `這是我的紀錄：${code}`,
    `${code} 請幫我匯入`,
    '```\n' + code + '\n```',
    `${code}。`,
    `紀錄→ ${code} ←貼這個`,
  ]) {
    assert.deepEqual(JSON.parse(await decodeBackupCode(wrapped)), payload, `解不開：${wrapped.slice(0, 24)}…`);
  }
});

test('零寬空格、軟連字號、BOM、全形冒號都清得掉——聊天軟體折長字串塞的就是這些', async () => {
  const code = await encodeBackupCode(payload);
  const [head, body] = code.split(':');
  const mangled = `\uFEFF${head}\uFF1A${body.slice(0, 10)}\u200B${body.slice(10, 30)}\u00AD${body.slice(30)}\u200D`;
  assert.deepEqual(JSON.parse(await decodeBackupCode(mangled)), payload);
});

test('版本號超過三位數不當成本站的代碼，不會印出科學記號', async () => {
  await assert.rejects(() => decodeBackupCode('langlearn1234:AAAA'), /不是本站的代碼/);
  await assert.rejects(() => decodeBackupCode(`langlearn${'9'.repeat(25)}:AAAA`), /不是本站的代碼/);
});

test('沒有壓縮能力時走版本 0，而且來回一致', async () => {
  /**
   * 這條路的受害者正是 iOS 16.4 以下、Firefox 113 以下——唯一會走 v0 的那批人。
   * 不測的話，把前綴寫反（標成 v1 卻沒壓縮）整套測試不會有任何反應，
   * 而他們產出的代碼在任何裝置上都解不開。
   */
  const saved = globalThis.CompressionStream;
  try {
    delete globalThis.CompressionStream;
    assert.equal(canCompress(), false);
    const code = await encodeBackupCode(payload);
    assert.ok(code.startsWith('langlearn0:'), `沒有壓縮能力應該產出版本 0，實際：${code.slice(0, 12)}`);
    assert.deepEqual(JSON.parse(await decodeBackupCode(code)), payload);
  } finally {
    globalThis.CompressionStream = saved;
  }
});

test('沒有解壓能力時對版本 1 說得清楚該怎麼辦', async () => {
  const code = await encodeBackupCode(payload);
  const saved = globalThis.DecompressionStream;
  try {
    delete globalThis.DecompressionStream;
    await assert.rejects(() => decodeBackupCode(code), /看不懂壓縮過的代碼.*檔案匯入/);
  } finally {
    globalThis.DecompressionStream = saved;
  }
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

const JSON_LIMIT = 10 * 1024 * 1024;
const CODE_LIMIT = 16 * 1024 * 1024;

/**
 * 用多位元組中文字造出精確 UTF-8 大小的假 JSON，不含真實學習資料。
 */
function jsonOfSize(size) {
  const contentBytes = size - Buffer.byteLength('{"text":""}');
  return JSON.stringify({ text: '字'.repeat(Math.floor(contentBytes / 3)) + 'a'.repeat(contentBytes % 3) });
}

function fixtureCode(json, version) {
  const bytes = Buffer.from(json);
  return `langlearn${version}:${(version === 1 ? gzipSync(bytes) : bytes).toString('base64')}`;
}

function isSizeError(error, limitBytes) {
  assert.equal(error.code, 'BACKUP_SIZE_LIMIT');
  assert.equal(error.limitBytes, limitBytes);
  assert.match(error.message, /超過.*MiB/);
  return true;
}

function replaceGlobal(t, name, value) {
  const saved = globalThis[name];
  globalThis[name] = value;
  t.after(() => { globalThis[name] = saved; });
}

for (const version of [0, 1]) {
  test(`S12 v${version} 解碼接受恰好 10 MiB UTF-8 JSON`, async () => {
    const json = jsonOfSize(JSON_LIMIT);
    assert.equal(Buffer.byteLength(json), JSON_LIMIT);
    assert.equal(await decodeBackupCode(fixtureCode(json, version)), json);
  });

  test(`S12 v${version} 解碼拒絕超過 10 MiB 一個 byte（v1 為真實 zip bomb）`, async () => {
    const code = fixtureCode(jsonOfSize(JSON_LIMIT + 1), version);
    assert.ok(Buffer.byteLength(code) < CODE_LIMIT);
    await assert.rejects(decodeBackupCode(code), (error) => isSizeError(error, JSON_LIMIT));
  });

  test(`D22 v${version} 匯出接受 10 MiB、拒絕多一個 byte，不能靠高壓縮率繞過`, async (t) => {
    if (version === 0) {
      const saved = globalThis.CompressionStream;
      delete globalThis.CompressionStream;
      t.after(() => { globalThis.CompressionStream = saved; });
    }
    const json = jsonOfSize(JSON_LIMIT);
    const code = await encodeBackupCode(JSON.parse(json));
    assert.ok(code.startsWith(`langlearn${version}:`));
    assert.equal(await decodeBackupCode(code), json);
    await assert.rejects(encodeBackupCode(JSON.parse(jsonOfSize(JSON_LIMIT + 1))),
      (error) => isSizeError(error, JSON_LIMIT));
  });
}

test('S12 16 MiB 代碼界線含原始包裝與空白，UTF-8 恰好接受、多一 byte 拒絕', async () => {
  const code = fixtureCode('{}', 0);
  const exact = ' '.repeat(CODE_LIMIT - code.length) + code;
  assert.equal(await decodeBackupCode(exact), '{}');
  await assert.rejects(decodeBackupCode(exact + ' '), (error) => isSizeError(error, CODE_LIMIT));
});

test('S12 不可見字元清理之前就以 UTF-8 bytes 擋住超大輸入', async () => {
  const code = fixtureCode('{}', 0);
  const text = '\u200B'.repeat(Math.floor((CODE_LIMIT - code.length) / 3) + 1) + code;
  assert.ok(text.length < CODE_LIMIT);
  assert.ok(Buffer.byteLength(text) > CODE_LIMIT);
  await assert.rejects(decodeBackupCode(text), (error) => isSizeError(error, CODE_LIMIT));
});

for (const cancelRejects of [false, true]) {
  test(`S12 解壓逐 chunk 止損、取消與釋放 reader（cancel 拒絕=${cancelRejects}）`, async (t) => {
    let reads = 0;
    let cancelled = 0;
    let stream;
    replaceGlobal(t, 'DecompressionStream', class {
      constructor() {
        stream = this;
        this.writable = new WritableStream();
        this.readable = new ReadableStream({
          pull(controller) {
            reads++;
            if (reads === 1) controller.enqueue(new Uint8Array(JSON_LIMIT));
            else if (reads === 2) controller.enqueue(new Uint8Array(1));
            else controller.error(new Error('不應繼續讀第三個 chunk'));
          },
          cancel(reason) {
            cancelled++;
            isSizeError(reason, JSON_LIMIT);
            if (cancelRejects) throw new Error('取消失敗也不能覆蓋原本限額錯誤');
          },
        }, { highWaterMark: 0 });
      }
    });
    await assert.rejects(decodeBackupCode('langlearn1:AAAA'), (error) => isSizeError(error, JSON_LIMIT));
    assert.equal(reads, 2);
    assert.equal(cancelled, 1);
    assert.equal(stream.readable.locked, false);
    assert.equal(stream.writable.locked, false);
  });
}

test('D22 匯出串流超過 base64 加前綴的 16 MiB 預算，立即取消', async (t) => {
  let cancelled = 0;
  t.mock.method(globalThis, 'btoa', () => assert.fail('超限不能先配置 base64'));
  const packedLimit = Math.floor((CODE_LIMIT - 'langlearn1:'.length) / 4) * 3;
  replaceGlobal(t, 'CompressionStream', class {
    constructor() {
      this.writable = new WritableStream();
      this.readable = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(packedLimit + 1));
        },
        pull(controller) { controller.close(); },
        cancel() { cancelled++; },
      }, { highWaterMark: 0 });
    }
  });
  await assert.rejects(encodeBackupCode({}), (error) => isSizeError(error, CODE_LIMIT));
  assert.equal(cancelled, 1);
});

test('S12 UTF-8 計數不拆開跨分段的 surrogate pair', async () => {
  const code = fixtureCode('{}', 0);
  const wrapped = 'a'.repeat(8191) + '😀' + code;
  const exact = wrapped + ' '.repeat(CODE_LIMIT - Buffer.byteLength(wrapped));
  assert.equal(Buffer.byteLength(exact), CODE_LIMIT);
  assert.equal(await decodeBackupCode(exact), '{}');
  await assert.rejects(decodeBackupCode(exact + '\uD800'), (error) => isSizeError(error, CODE_LIMIT));

  const value = { text: 'a'.repeat(8182) + '😀' };
  assert.deepEqual(JSON.parse(await decodeBackupCode(await encodeBackupCode(value))), value);
});

test('S12 不信任的 payload 設定與額外參數不能放寬正式上限', async () => {
  const settings = { jsonMaxBytes: 2 ** 30, codeMaxBytes: 2 ** 30 };
  const value = { limits: settings, text: 'a'.repeat(JSON_LIMIT) };
  await assert.rejects(encodeBackupCode(value, settings), (error) => isSizeError(error, JSON_LIMIT));
  await assert.rejects(decodeBackupCode(fixtureCode(JSON.stringify(value), 1), settings),
    (error) => isSizeError(error, JSON_LIMIT));
});

test('S12 沒有壓縮、解壓 API 的舊瀏覽器仍可往返 v0', async (t) => {
  replaceGlobal(t, 'CompressionStream', undefined);
  replaceGlobal(t, 'DecompressionStream', undefined);
  const value = { text: '繁體中文😀' };
  const code = await encodeBackupCode(value);
  assert.ok(code.startsWith('langlearn0:'));
  assert.deepEqual(JSON.parse(await decodeBackupCode(code)), value);
});

test('S12 取消仍在等待時 writer 拒絕也沒有 unhandled rejection', async (t) => {
  let rejectWrite;
  let stream;
  const writerError = new Error('取消引起寫端拒絕');
  replaceGlobal(t, 'DecompressionStream', class {
    constructor() {
      stream = this;
      this.writable = new WritableStream({
        write() { return new Promise((resolve, reject) => { rejectWrite = reject; }); },
      });
      this.readable = new ReadableStream({
        pull(controller) { controller.enqueue(new Uint8Array(JSON_LIMIT + 1)); },
        cancel() {
          rejectWrite(writerError);
          return new Promise((resolve) => setTimeout(resolve, 25));
        },
      }, { highWaterMark: 0 });
    }
  });
  await assert.rejects(decodeBackupCode('langlearn1:AAAA'), (error) => isSizeError(error, JSON_LIMIT));
  assert.equal(stream.writable.locked, false);
  assert.equal(stream.readable.locked, false);
  await new Promise((resolve) => setImmediate(resolve));
});

test('D22 writer.close 拒絕必須傳回失敗，不能回傳成功代碼', async (t) => {
  const failure = new Error('writer.close 失敗');
  let stream;
  replaceGlobal(t, 'CompressionStream', class {
    constructor() {
      stream = this;
      this.writable = new WritableStream({ close() { throw failure; } });
      this.readable = new ReadableStream({ start(controller) { controller.close(); } });
    }
  });
  await assert.rejects(encodeBackupCode({}), (error) => error === failure);
  assert.equal(stream.writable.locked, false);
  assert.equal(stream.readable.locked, false);
});

test('S12 真實 gzip 截斷與 CRC 損壞均拒絕且沒有延遲的 unhandled rejection', async () => {
  const zipped = gzipSync(Buffer.from(JSON.stringify(payload)));
  const corrupt = Buffer.from(zipped);
  corrupt[corrupt.length - 8] ^= 0xff;
  for (const bad of [zipped.subarray(0, zipped.length - 8), corrupt]) {
    await assert.rejects(decodeBackupCode(`langlearn1:${bad.toString('base64')}`), /解不開/);
  }
  await new Promise((resolve) => setImmediate(resolve));
});
