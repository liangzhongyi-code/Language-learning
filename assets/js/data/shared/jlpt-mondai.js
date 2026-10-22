/**
 * JLPT 模擬題的區段與問題號。
 *
 * 編號照 JLPT 試卷：「言語知識（文字・語彙）」的問題1–4 與「言語知識（文法）」的問題1–3
 * 各自從 1 起算，所以單看問題號會撞號，一律用 section + mondai 才能唯一定位一個題型。
 *
 * form 決定題面怎麼標出考點，schema 依此檢查、畫面依此呈現：
 *   underline   題面有一段畫底線的字，存在題目的 underline 欄位
 *   blank       題面剛好一個括號空格（BLANK）
 *   paraphrase  整句就是要換說法的對象，沒有底線也沒有空格
 *
 * ask 是本專案自寫的日文問法（N5 程度的假名寫法），askZh 是作答後顯示的中文對照。
 * 不搬上游原文，也不照抄官方試題的說明文字。
 */

/**
 * 括號空格的唯一寫法：全形括號加兩個全形空格。
 * 匯入時統一成這個寫法，schema 才能用字面比對數出空格數。
 */
export const JLPT_BLANK = '（　　）';

/**
 * 區段。label 是畫面上的名稱
 */
export const JLPT_SECTIONS = {
  moji: { label: '文字' },
  goi: { label: '語彙' },
  bunpou: { label: '文法' },
};

/**
 * 各題型。順序即設定畫面的排列順序
 */
export const JLPT_MONDAI = [
  {
    key: 'moji-1',
    section: 'moji',
    mondai: 1,
    label: '漢字讀法',
    form: 'underline',
    ask: '＿＿の ことばは ひらがなで どう かきますか。',
    askZh: '畫底線的詞，用平假名要怎麼寫？',
  },
  {
    key: 'moji-2',
    section: 'moji',
    mondai: 2,
    label: '表記',
    form: 'underline',
    ask: '＿＿の ことばは どう かきますか。',
    askZh: '畫底線的詞，用漢字或片假名要怎麼寫？',
  },
  {
    key: 'goi-3',
    section: 'goi',
    mondai: 3,
    label: '文脈規定',
    form: 'blank',
    ask: '（　　）に なにを いれますか。',
    askZh: '括號裡要填哪一個詞？',
  },
  {
    key: 'goi-4',
    section: 'goi',
    mondai: 4,
    label: '言い換え類義',
    form: 'paraphrase',
    ask: 'つぎの ぶんと だいたい おなじ いみの ぶんは どれですか。',
    askZh: '哪一句的意思跟題目這句大致相同？',
  },
  {
    key: 'bunpou-1',
    section: 'bunpou',
    mondai: 1,
    label: '文法形式',
    form: 'blank',
    ask: '（　　）に なにを いれますか。',
    askZh: '括號裡要填哪一個（助詞、變化或句型）？',
  },
];

/**
 * 依區段與問題號找題型；不存在時回傳 null
 */
export function jlptMondaiOf(section, mondai) {
  return JLPT_MONDAI.find((m) => m.section === section && m.mondai === mondai) ?? null;
}

/**
 * 題型鍵值清單，供設定畫面與篩選用
 */
export const JLPT_MONDAI_KEYS = JLPT_MONDAI.map((m) => m.key);
