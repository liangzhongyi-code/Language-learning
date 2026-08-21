/**
 * 洗牌與抽樣。
 * 亂數來源一律以參數注入，預設 Math.random，
 * 測試時可傳入固定序列的假亂數來取得可重現的結果。
 */

/**
 * Fisher-Yates 洗牌。
 * 不就地改動來源陣列，一律回傳新陣列。
 */
export function shuffle(list, rng = Math.random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * 從陣列中取出 count 個不重複的元素。
 * count 大於來源長度時取全部，小於等於 0 時回傳空陣列。
 */
export function sample(list, count, rng = Math.random) {
  if (count <= 0) return [];
  return shuffle(list, rng).slice(0, Math.min(count, list.length));
}
