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

/**
 * 讀解的題型：一篇短文（統合理解是兩篇）帶多題。
 *
 * 鍵值用題型名稱而不是問題號：各級的讀解問題號不同（N1 是問題8～13，N2 從問題10 起），
 * 用號碼當鍵值，收第二個級別時就會撞號。畫面上的「問題N」由 mondaiByLevel 依級別決定，
 * 編號依官方《N1 大問のねらい》（2026-10-23 核對）。
 *
 * minChars 是官方字數的七成，低於它就不算這個題型的短文（統合理解算兩篇合計）。
 * shuffle 為 false 的題型照原順序出選項：情報檢索的選項依原文出現順序排列，打亂反而難讀。
 * ask 是本專案自寫的日文說明，askZh 是作答後顯示的中文對照。
 */
export const JLPT_READING_TYPES = [
  {
    key: 'dokkai-tanbun',
    type: 'tanbun',
    label: '內容理解（短文）',
    mondaiByLevel: { 5: 8 },
    minChars: 140,
    shuffle: true,
    dual: false,
    ask: '次の文章を読んで、問いに対する答えとして最もよいものを一つ選びなさい。',
    askZh: '讀完下面的短文，選出最適合的答案。',
  },
  {
    key: 'dokkai-chubun',
    type: 'chubun',
    label: '內容理解（中文）',
    mondaiByLevel: { 5: 9 },
    minChars: 350,
    shuffle: true,
    dual: false,
    ask: '次の文章を読んで、問いに対する答えとして最もよいものを一つ選びなさい。',
    askZh: '讀完下面的文章，選出最適合的答案。',
  },
  {
    key: 'dokkai-chobun',
    type: 'chobun',
    label: '內容理解（長文）',
    mondaiByLevel: { 5: 10 },
    minChars: 700,
    shuffle: true,
    dual: false,
    ask: '次の文章を読んで、問いに対する答えとして最もよいものを一つ選びなさい。',
    askZh: '讀完下面的長文，選出最適合的答案。',
  },
  {
    key: 'dokkai-togo',
    type: 'togo',
    label: '統合理解',
    mondaiByLevel: { 5: 11 },
    minChars: 420,
    shuffle: true,
    dual: true,
    ask: '次のAとBの文章を読んで、問いに対する答えとして最もよいものを一つ選びなさい。',
    askZh: '讀完 A、B 兩篇文章，比較兩者後選出最適合的答案。',
  },
  {
    key: 'dokkai-shucho',
    type: 'shucho',
    label: '主張理解（長文）',
    mondaiByLevel: { 5: 12 },
    minChars: 700,
    shuffle: true,
    dual: false,
    ask: '次の文章を読んで、問いに対する答えとして最もよいものを一つ選びなさい。',
    askZh: '讀完下面的評論，掌握筆者的主張後選出最適合的答案。',
  },
  {
    key: 'dokkai-joho',
    type: 'joho',
    label: '情報檢索',
    mondaiByLevel: { 5: 13 },
    minChars: 490,
    shuffle: false,
    dual: false,
    ask: '次の案内を読んで、問いに対する答えとして最もよいものを一つ選びなさい。',
    askZh: '讀完下面的公告或說明，從中找出需要的資訊並選出答案。',
  },
];

/**
 * 讀解題的考點。key 是資料裡的 focus，label 是畫面上的名稱
 */
export const JLPT_READING_FOCUS = {
  main: '主旨',
  detail: '內容一致',
  reason: '理由',
  underline: '劃線句',
  reference: '指示語',
  common: '共通點',
  difference: '相異點',
  condition: '條件篩選',
  notice: '注意事項',
};

/**
 * 依題型名稱找讀解題型；不存在時回傳 null
 */
export function jlptReadingTypeOf(type) {
  return JLPT_READING_TYPES.find((t) => t.type === type) ?? null;
}

/**
 * 一筆 JLPT 題目屬於哪個題型鍵值。讀解題（有 type）用名稱，一題一筆的用區段＋問題號
 */
export function jlptKindKeyOf(item) {
  return item?.type ? `dokkai-${item.type}` : `${item?.section}-${item?.mondai}`;
}

/**
 * 設定畫面的題型清單：一題一筆的題型（目前只有 N5 的編號）加上讀解題型。
 * level 為 null 時列出全部；給級別時，讀解題型只列出該級有問題號的。
 * label 已帶上「問題N」，讀解題型在不分級時不顯示號碼（各級號碼不同）。
 */
export function jlptKindsAt(level = null) {
  const single = JLPT_MONDAI.map((m) => ({ key: m.key, label: `問題${m.mondai} ${m.label}`, levels: [1] }));
  const reading = JLPT_READING_TYPES.map((t) => ({
    key: t.key,
    label: level && t.mondaiByLevel[level] ? `問題${t.mondaiByLevel[level]} ${t.label}` : `讀解 ${t.label}`,
    levels: Object.keys(t.mondaiByLevel).map(Number),
  }));
  return [...single, ...reading].filter((k) => level === null || k.levels.includes(level));
}

/**
 * 全部題型鍵值（一題一筆＋讀解），設定畫面的預設勾選
 */
export const JLPT_KIND_KEYS = [...JLPT_MONDAI_KEYS, ...JLPT_READING_TYPES.map((t) => t.key)];
