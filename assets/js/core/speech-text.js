/**
 * 決定一筆資料要送給語音引擎的文字。
 *
 * 這條規則本來散在 quiz-engine、vocab-view、grammar-view 三個地方各寫一份，
 * 而且寫法還不一樣（`&&` 版與 `||` 版），結果等價純屬巧合。
 * 它是帶條件分支的計算，放在 ui 層就測不到——所以收進 core。
 */

/**
 * 需要改用讀音欄位朗讀的語言。
 * 日文若把漢字直接丟給語音引擎，會被唸成另一種讀法
 * （「雨」可能被唸成 う 而不是 あめ），所以一律送假名。
 */
const READING_LANGS = ['ja'];

/**
 * 取得朗讀用的文字。
 * 沒有讀音欄位時退回目標語言原文，不會回傳空值。
 */
export function speakTextOf(item, lang) {
  if (!item) return '';
  if (READING_LANGS.includes(lang)) return item.reading || item.target || '';
  return item.target || '';
}
