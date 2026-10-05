/**
 * 把備份變成一串可以複製貼上的文字，以及把它解回來。
 *
 * 檔案在手機之間搬很麻煩（iOS 尤其），但一串文字到處都能貼：
 * 訊息、備忘錄、郵件、雲端筆記。只要對面把它貼回這一頁，紀錄就回來了。
 *
 * 形狀：`langlearn<版本>:<base64>`。
 *   版本 1 — gzip 之後 base64。JSON 的鍵名高度重複，壓縮率通常五到八倍，
 *            幾週的紀錄壓完幾千字，多數通訊軟體單則訊息放得下。
 *   版本 0 — 不壓縮、直接 base64。給沒有 CompressionStream 的舊瀏覽器。
 * 解碼端兩種都認；前綴讓貼錯東西時能明確說「這不是本站的代碼」，
 * 而不是丟一句 base64 解不開。
 *
 * base64 而不是原始 JSON：通訊軟體會把直引號換成彎引號、把換行吃掉，
 * JSON 一過手就壞；base64 只有字母數字與 +/=，什麼管道都安全。
 *
 * 只用瀏覽器與 Node 都有的全域（TextEncoder、btoa、CompressionStream），
 * 所以這一支放在 core、測試可以直接跑。
 */

import { BACKUP_JSON_MAX_BYTES, BACKUP_CODE_MAX_BYTES } from './backup-limits.js';

const PREFIX = 'langlearn';
const V_PLAIN = 0;
const V_GZIP = 1;

/**
 * 大小錯誤保留穩定 code 與 byte 上限，解壓失敗時不能被改寫成損壞代碼。
 */
class BackupSizeError extends Error {
  constructor(label, limitBytes) {
    super(`${label}超過 ${limitBytes / (1024 * 1024)} MiB 上限。`);
    this.code = 'BACKUP_SIZE_LIMIT';
    this.limitBytes = limitBytes;
  }
}

/**
 * 分段計算 UTF-8 bytes，避免為了拒絕超大字串先配置同樣大的編碼陣列。
 * 不拆開 surrogate pair；孤立 surrogate 的 bytes 與 TextEncoder 相同。
 */
function checkTextSize(text, limitBytes, error) {
  if (text.length > limitBytes) throw error;
  const encoder = new TextEncoder();
  let total = 0;
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 8192, text.length);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xD800 && last <= 0xDBFF) end--;
    total += encoder.encode(text.slice(start, end)).byteLength;
    if (total > limitBytes) throw error;
    start = end;
  }
}

/**
 * 超過這個字數就不建議貼進聊天訊息。
 *
 * 要看的是全場最緊的那家，不是最寬的：Telegram 單則硬上限 4,096 字（超過會被
 * 切成多則或拒收）、LINE Messaging API 5,000、LINE App 10,000、WhatsApp 65,536、
 * iMessage 無明訂。取 4,000，含 `langlearn1:` 前綴仍低於 4,096。
 * 超過就提示改貼備忘錄或郵件——那兩個沒有實際上限。
 */
export const CHAT_FRIENDLY_CHARS = 4000;

/**
 * Uint8Array → base64。
 * 一次 fromCharCode 太多參數會超過引擎的參數上限，分段餵。
 */
function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function fromBase64(text) {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * 每個 chunk 先檢查限額，確認全部在界線內才合併；失敗立即取消讀端。
 */
async function drain(stream, maxBytes, sizeError) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw sizeError;
      if (value.byteLength) chunks.push(value);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * 把 bytes 送過一個轉換串流（壓縮或解壓）。
 * 寫入與讀取要同時進行——先把 write 等完再讀的話，資料一大就會因為
 * 背壓互相等待而卡死。
 */
async function through(transform, bytes, maxBytes, sizeError) {
  const writer = transform.writable.getWriter();
  const writing = (async () => {
    try {
      await writer.write(bytes);
      await writer.close();
    } finally {
      writer.releaseLock();
    }
  })();
  /**
   * 立即接手寫端拒絕；讀端可能還在讀取或等待 cancel，尚未 await writing。
   * 不等到 catch 才掛處理器，避免截斷或超限導致 unhandled rejection。
   * 後面仍等待寫端結束，並保留先遇到的讀端錯誤。
   */
  writing.catch(() => {});
  try {
    const out = await drain(transform.readable, maxBytes, sizeError);
    await writing;
    return out;
  } catch (error) {
    await writer.abort(error).catch(() => {});
    await writing.catch(() => {});
    throw error;
  }
}

/**
 * 這個環境能不能壓縮
 */
export function canCompress() {
  return typeof CompressionStream === 'function';
}

/**
 * 備份物件 → 代碼字串
 */
export async function encodeBackupCode(payload) {
  const json = JSON.stringify(payload);
  checkTextSize(json, BACKUP_JSON_MAX_BYTES, new BackupSizeError('備份 JSON ', BACKUP_JSON_MAX_BYTES));
  const bytes = new TextEncoder().encode(json);
  const codeError = new BackupSizeError('備份代碼', BACKUP_CODE_MAX_BYTES);
  const version = canCompress() ? V_GZIP : V_PLAIN;
  const prefix = `${PREFIX}${version}:`;
  const packedLimit = Math.floor((BACKUP_CODE_MAX_BYTES - prefix.length) / 4) * 3;
  let packed = bytes;
  if (version === V_GZIP) {
    packed = await through(new CompressionStream('gzip'), bytes, packedLimit, codeError);
  }
  if (packed.byteLength > packedLimit) throw codeError;
  return `${prefix}${toBase64(packed)}`;
}

/**
 * 代碼字串 → 備份的 JSON 文字。
 *
 * 回傳文字而不是物件，讓呼叫端接到 parseBackup 走與檔案匯入完全相同的
 * 驗證與預覽流程——代碼只是另一種容器，裡面的東西該過同一道檢查。
 *
 * 貼過來的東西先把所有空白拔掉：聊天軟體會在長字串裡塞換行，
 * 使用者手動選取也常多帶一個尾巴的換行。
 * 錯誤訊息都是給使用者看的，直接顯示。
 */
export async function decodeBackupCode(text) {
  const input = String(text ?? '');
  checkTextSize(input, BACKUP_CODE_MAX_BYTES, new BackupSizeError('備份代碼輸入', BACKUP_CODE_MAX_BYTES));
  /**
   * 先把看不見的東西清掉。
   * \s 涵蓋一般空白與換行，但不含零寬空格（U+200B–200D）、軟連字號（U+00AD）
   * 與 BOM（U+FEFF）——那正是聊天軟體為了折超長字串塞進來的字元，
   * 少清一個就會讓比對落空，使用者被告知「這不是本站的代碼」，而它就是。
   * 全形冒號是輸入法的常見副作用，一併換回半形。
   */
  const cleaned = input
    .replace(/[\s\u200B-\u200D\u00AD\uFEFF]+/g, '')
    .replace(/\uFF1A/g, ':');
  if (!cleaned) throw new Error('還沒有貼上代碼。');

  /**
   * 先試整串剛好就是代碼；不中再從文字裡抽出第一段——
   * 從聊天訊息複製時常夾著「這是我的紀錄：」或程式碼圍欄。
   * 抽出來的尾端若黏了英文字母會被吸進 base64 而解不開，但那會是明確的錯誤
   * （gzip 有 CRC 與長度把關、v0 有 JSON.parse），不會靜靜解出錯的資料。
   *
   * 版本號限三位數：更長的不可能是我們產的，直接當成不是本站的代碼，
   * 也免得訊息裡印出 v1e+21 這種科學記號。
   */
  const pattern = /langlearn(\d{1,3}):([A-Za-z0-9+/=]+)/;
  const match = cleaned.match(new RegExp(`^${pattern.source}$`)) ?? cleaned.match(pattern);
  if (!match) throw new Error('這不是本站的代碼，沒有動任何資料。');

  const version = Number(match[1]);
  if (version > V_GZIP) throw new Error(`這串代碼是較新的格式（v${version}），這個版本的網站看不懂。`);

  let bytes;
  try {
    bytes = fromBase64(match[2]);
  } catch {
    throw new Error('代碼不完整，可能少複製了一段。');
  }

  if (version === V_GZIP) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('這個瀏覽器看不懂壓縮過的代碼，請改用檔案匯入。');
    }
    try {
      bytes = await through(new DecompressionStream('gzip'), bytes, BACKUP_JSON_MAX_BYTES,
        new BackupSizeError('解壓後備份', BACKUP_JSON_MAX_BYTES));
    } catch (error) {
      if (error instanceof BackupSizeError) throw error;
      throw new Error('代碼不完整或被改動過，解不開。');
    }
  }

  if (bytes.byteLength > BACKUP_JSON_MAX_BYTES) throw new BackupSizeError('備份 JSON ', BACKUP_JSON_MAX_BYTES);
  return new TextDecoder().decode(bytes);
}

/**
 * 給畫面用的字數提示：這串代碼能不能貼進聊天訊息
 */
export function codeSizeHint(code) {
  const chars = String(code ?? '').length;
  return { chars, chatFriendly: chars > 0 && chars <= CHAT_FRIENDLY_CHARS };
}
