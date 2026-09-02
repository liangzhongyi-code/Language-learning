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

const PREFIX = 'langlearn';
const V_PLAIN = 0;
const V_GZIP = 1;

/**
 * 超過這個字數就不建議貼進聊天訊息。
 * 各家上限不同（LINE 約一萬字、iMessage 更長），取一個保守值；
 * 超過就提示改貼備忘錄或郵件——那兩個沒有實際上限。
 */
export const CHAT_FRIENDLY_CHARS = 5000;

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
 * 把一條 ReadableStream 讀到底，接成一個 Uint8Array
 */
async function drain(stream) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
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
async function through(transform, bytes) {
  const writer = transform.writable.getWriter();
  const writing = writer.write(bytes).then(() => writer.close());
  /**
   * 先掛一個接手。讀端解壓失敗（代碼被截斷）時 drain 會先拋出，
   * 這個函式就此結束，寫端的 promise 之後才被串流的錯誤打回來——
   * 沒人等它就變成 unhandled rejection。真正要報的錯誤 drain 已經拋了，
   * 寫端這一份不必再冒出來。
   */
  writing.catch(() => {});
  const out = await drain(transform.readable);
  await writing;
  return out;
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
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  if (canCompress()) {
    const packed = await through(new CompressionStream('gzip'), bytes);
    return `${PREFIX}${V_GZIP}:${toBase64(packed)}`;
  }
  return `${PREFIX}${V_PLAIN}:${toBase64(bytes)}`;
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
  const cleaned = String(text ?? '').replace(/\s+/g, '');
  if (!cleaned) throw new Error('還沒有貼上代碼。');

  const match = cleaned.match(/^langlearn(\d+):([A-Za-z0-9+/=]+)$/);
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
      bytes = await through(new DecompressionStream('gzip'), bytes);
    } catch {
      throw new Error('代碼不完整或被改動過，解不開。');
    }
  }

  return new TextDecoder().decode(bytes);
}

/**
 * 給畫面用的字數提示：這串代碼能不能貼進聊天訊息
 */
export function codeSizeHint(code) {
  const chars = String(code ?? '').length;
  return { chars, chatFriendly: chars > 0 && chars <= CHAT_FRIENDLY_CHARS };
}
