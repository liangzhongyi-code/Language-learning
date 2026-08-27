/**
 * 主題分類對照表。
 * 除了單字頁的篩選之外，測驗的干擾選項也靠它挑「同一個語意範疇」的詞，
 * 所以每個分類至少要有 4 筆單字，否則干擾選項會頻繁退化成跨類別亂抽。
 *
 * 商務類的切法直接沿用 ETS 公布的多益測驗內容領域（一般商務、人事、
 * 財務預算、製造、採購、辦公室、旅遊、外食⋯），而不是自己發明一套。
 * 這樣分出來的干擾選項才會落在同一個真實情境裡，
 * 例如「發票」的干擾項是「報價單、收據、預算」而不是「香蕉」。
 *
 * group 只影響顯示時的分組，不影響干擾選項的挑選邏輯。
 */
export const CATEGORIES = {
  /* ── 生活基礎 ── */
  food: '食物',
  drink: '飲料',
  dining: '餐飲外食',
  animal: '動物',
  sport: '運動',
  transport: '交通',
  daily: '日常',
  body: '身體',
  clothing: '服飾',
  house: '居家',
  weather: '天氣',
  nature: '自然',
  family: '家人',
  person: '人與稱謂',
  place: '地點',
  time: '時間',
  color: '顏色',

  /* ── 通用抽象 ── */
  emotion: '情緒',
  thought: '思考認知',
  communication: '溝通表達',
  movement: '移動動作',
  quantity: '數量程度',
  quality: '性質狀態',
  education: '教育學習',
  health: '健康醫療',
  society: '社會',
  law: '法律合約',
  media: '媒體資訊',
  abstract: '抽象概念',
  grammar: '功能詞',

  /* ── 商務職場（多益測驗內容領域）── */
  business: '一般商務',
  office: '辦公室',
  finance: '財務金融',
  hr: '人事招募',
  marketing: '行銷業務',
  manufacturing: '製造生產',
  logistics: '採購物流',
  tech: '技術科技',
  travel: '旅遊出差',
  realestate: '房產設施',
  entertainment: '娛樂活動',
};

/**
 * 分類的分組，供 UI 把幾十個分類收成幾個區塊。
 * 沒有列在這裡的分類會被歸到「其他」，不會消失。
 */
export const CATEGORY_GROUPS = [
  {
    key: 'life',
    label: '生活',
    keys: ['food', 'drink', 'dining', 'animal', 'sport', 'transport', 'daily', 'body',
      'clothing', 'house', 'weather', 'nature', 'family', 'person', 'place', 'time', 'color'],
  },
  {
    key: 'general',
    label: '通用',
    keys: ['emotion', 'thought', 'communication', 'movement', 'quantity', 'quality',
      'education', 'health', 'society', 'law', 'media', 'abstract', 'grammar'],
  },
  {
    key: 'work',
    label: '商務',
    keys: ['business', 'office', 'finance', 'hr', 'marketing', 'manufacturing',
      'logistics', 'tech', 'travel', 'realestate', 'entertainment'],
  },
];

/**
 * 分類代碼清單，供資料驗證用
 */
export const CATEGORY_KEYS = Object.keys(CATEGORIES);

/**
 * 取分類的中文標籤，未知代碼原樣回傳，避免 UI 出現 undefined
 */
export function categoryLabel(key) {
  return CATEGORIES[key] || key;
}

/**
 * 取分類所屬的分組代碼，沒歸類的一律回傳 'other'
 */
export function categoryGroup(key) {
  const found = CATEGORY_GROUPS.find((g) => g.keys.includes(key));
  return found ? found.key : 'other';
}
