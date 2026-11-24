/**
 * 五十音表的格子 HTML。對照表頁與測驗頁的小抄共用，兩邊的表才不會長得不一樣。
 *
 * 每一行最左邊是行名、最上面是母音，讓沒學過的人看得出規律：
 * 橫著看同一行是同一個子音，直著看同一段是同一個母音。
 * 朗讀由 speech.js 的事件委派處理，這裡只放 data-speak。
 */

/**
 * HTML 逸出，避免資料裡的角括號或引號破壞結構
 */
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * 五段（清音／濁音／半濁音共用）
 */
const VOWEL_COLUMNS = ['a', 'i', 'u', 'e', 'o'];

/**
 * 拗音的三段
 */
const YOUON_COLUMNS = ['ya', 'yu', 'yo'];

/**
 * 四個區塊的行列定義。
 * rows 用資料檔的 row 欄位，columns 用 column 欄位，
 * 交集找不到資料的位置就是表格裡該留的空位。
 */
export const KANA_SECTIONS = [
  {
    type: 'seion',
    label: '清音',
    note: '最基本的 46 個，先背這一區。',
    rows: ['あ', 'か', 'さ', 'た', 'な', 'は', 'ま', 'や', 'ら', 'わ', 'ん'],
    columns: VOWEL_COLUMNS,
  },
  {
    type: 'dakuon',
    label: '濁音',
    note: '清音右上加兩點（゛），子音變濁。箭頭後面是它的清音。',
    rows: ['が', 'ざ', 'だ', 'ば'],
    columns: VOWEL_COLUMNS,
  },
  {
    type: 'handakuon',
    label: '半濁音',
    note: '只有は行，右上加小圈（゜），唸成 p。',
    rows: ['ぱ'],
    columns: VOWEL_COLUMNS,
  },
  {
    type: 'youon',
    label: '拗音',
    note: '後面接小寫的 ゃゅょ，兩個字唸成一個音。',
    rows: ['き', 'し', 'ち', 'に', 'ひ', 'み', 'り', 'ぎ', 'じ', 'び', 'ぴ'],
    columns: YOUON_COLUMNS,
  },
];

/**
 * 依模式決定要顯示哪一套假名。並列時平假名在左、片假名在右，兩套一樣大。
 */
function glyphHtml(item, mode) {
  const hira = `<span class="hira">${esc(item.hiragana)}</span>`;
  const kata = `<span class="kata">${esc(item.katakana)}</span>`;
  if (mode === 'hiragana') return hira;
  if (mode === 'katakana') return kata;
  return hira + kata;
}

/**
 * 一格假名。item 為 null 代表這個段位沒有假名，放佔位格讓後面的格子不會往前遞補。
 *
 * 拗音的 hiragana／katakana 本來就是兩個字元，直接整串交給語音引擎，
 * 不會被拆成兩次朗讀。
 */
function cellHtml(item, mode, compact) {
  if (!item) return '<div class="kana blank"></div>';
  const speakText = mode === 'katakana' ? item.katakana : item.hiragana;
  const sub = item.seionSource && !compact ? `<span class="sub">← ${esc(item.seionSource)}</span>` : '';
  const example = compact ? '' : `<span class="example">${esc(item.exampleWord)} ${esc(item.exampleZh)}</span>`;
  return (
    `<button class="kana" type="button" data-speak="${esc(speakText)}" data-speak-lang="ja">` +
    `<span class="glyph" lang="ja">${glyphHtml(item, mode)}</span>` +
    `<span class="romaji">${esc(item.romaji)}</span>${sub}${example}</button>`
  );
}

/**
 * 一個區塊的整張格狀表，含欄標題與行標題。
 * 每一行固定輸出 columns.length 格，缺的補空白格，表格才會真的對齊。
 */
export function kanaGridHtml(section, items, mode, { compact = false } = {}) {
  const columns = section.columns.length;
  const head = `<div class="kana-row"><span></span>${section.columns
    .map((column) => `<span class="kana-col">${esc(column)}</span>`)
    .join('')}</div>`;
  const body = section.rows
    .map((row) => {
      const cells = section.columns
        .map((column) => {
          const item = (items || []).find((k) => k.type === section.type && k.row === row && k.column === column);
          return cellHtml(item || null, mode, compact);
        })
        .join('');
      const label = row === 'ん' ? 'ん' : `${row}行`;
      return `<div class="kana-row"><span class="kana-rowhead" lang="ja">${esc(label)}</span>${cells}</div>`;
    })
    .join('');
  return (
    `<div class="kana-grid kana-table${compact ? ' is-compact' : ''}" data-section="${section.type}"` +
    ` style="grid-template-columns:auto repeat(${columns},minmax(0,1fr))">${head}${body}</div>`
  );
}
