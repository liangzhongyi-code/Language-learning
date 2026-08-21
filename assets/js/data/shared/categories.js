/**
 * 主題分類對照表。
 * 除了單字頁的篩選之外，測驗的干擾選項也靠它挑「同一個語意範疇」的詞，
 * 所以每個分類至少要有 4 筆單字，否則干擾選項會頻繁退化成跨類別亂抽。
 */
export const CATEGORIES = {
  food: '食物',
  drink: '飲料',
  animal: '動物',
  sport: '運動',
  transport: '交通',
  daily: '日常',
  body: '身體',
  weather: '天氣',
  family: '家人',
  place: '地點',
  time: '時間',
  color: '顏色',
};

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
