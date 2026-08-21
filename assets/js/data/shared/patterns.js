/**
 * 句型表。
 * roles 陣列是「目標語言」的角色順序，句子資料的 chunks 陣列順序必須與它一致。
 * 中文語序另由每個 chunk 的 zhIndex 表示。
 */
export const patterns = [
  /* ── 英文 ── */
  {
    id: 'en-p-svo',
    lang: 'en',
    name: '主詞 + 動詞 + 受詞',
    roles: ['subject', 'verb', 'object'],
    desc: '英文最基本的句型，語序與中文相同，適合當入門對照。',
  },
  {
    id: 'en-p-svo-time',
    lang: 'en',
    name: '主詞 + 動詞 + 受詞 + 時間',
    roles: ['subject', 'verb', 'object', 'time'],
    desc: '中文把時間放在主詞後面，英文多半放句尾——這是最常見的語序落差。',
  },
  {
    id: 'en-p-svo-place',
    lang: 'en',
    name: '主詞 + 動詞 + 受詞 + 地點',
    roles: ['subject', 'verb', 'object', 'place'],
    desc: '中文的地點在動詞前（在公園打球），英文在動詞後（play in the park）。',
  },
  {
    id: 'en-p-sv-place-time',
    lang: 'en',
    name: '主詞 + 動詞 + 地點 + 時間',
    roles: ['subject', 'verb', 'place', 'time'],
    desc: '英文同時有地點與時間時，順序固定是「先地點後時間」，與中文相反。',
  },
  {
    id: 'en-p-be-adj',
    lang: 'en',
    name: '主詞 + be動詞 + 形容詞',
    roles: ['subject', 'verb', 'adjective'],
    desc: '中文的「我很累」沒有動詞，英文一定要補上 be 動詞。',
  },
  {
    id: 'en-p-neg',
    lang: 'en',
    name: '主詞 + 否定 + 動詞 + 受詞',
    roles: ['subject', 'negation', 'verb', 'object'],
    desc: '否定詞放在主要動詞前面，與中文的「不」位置相近。',
  },

  /* ── 日文 ── */
  {
    id: 'ja-p-sov',
    lang: 'ja',
    name: '主詞 + は + 受詞 + を + 動詞',
    roles: ['subject', 'particle', 'object', 'particle', 'verb'],
    desc: '日文的基本骨架：動詞永遠在句尾，助詞標示前一個詞的角色。',
  },
  {
    id: 'ja-p-sotv',
    lang: 'ja',
    name: '主詞 + は + 時間 + 受詞 + を + 動詞',
    roles: ['subject', 'particle', 'time', 'object', 'particle', 'verb'],
    desc: '時間插在主題與受詞之間，動詞仍然墊底。',
  },
  {
    id: 'ja-p-splv',
    lang: 'ja',
    name: '主詞 + は + 地點 + で + 動詞',
    roles: ['subject', 'particle', 'place', 'particle', 'verb'],
    desc: '助詞「で」標示動作發生的場所，與「に」的存在地點不同。',
  },
  {
    id: 'ja-p-adj',
    lang: 'ja',
    name: '主詞 + は + 形容詞',
    roles: ['subject', 'particle', 'adjective'],
    desc: '形容詞本身就能當述語結尾，不需要另外補動詞。',
  },
  {
    id: 'ja-p-neg',
    lang: 'ja',
    name: '主詞 + は + 受詞 + を + 否定動詞',
    roles: ['subject', 'particle', 'object', 'particle', 'negation'],
    desc: '日文的否定靠動詞變化（ません／ない）表現，沒有獨立的否定詞。',
  },
];

/**
 * 依語言取出句型清單
 */
export function patternsOf(lang) {
  return patterns.filter((p) => p.lang === lang);
}

/**
 * 依 id 取出單一句型，找不到時回傳 undefined
 */
export function patternById(id) {
  return patterns.find((p) => p.id === id);
}
