/**
 * 外觀設定的合法值。匯入舊備份或手改資料時，逐欄回到安全預設。
 */
export const PALETTES = [
  { value: 'classic', label: '經典藍' },
  { value: 'midnight', label: '午夜藍' },
  { value: 'forest', label: '森墨綠' },
  { value: 'warm', label: '暖砂棕' },
];
export const BACKGROUNDS = [
  { value: 'plain', label: '純色', note: '專注閱讀' },
  { value: 'aurora', label: '柔光', note: '漸層光暈' },
  { value: 'dust', label: '微塵', note: '光點與柔光' },
];

export function normalizeAppearance(value) {
  return {
    theme: value?.theme === 'light' ? 'light' : 'dark',
    palette: PALETTES.some((p) => p.value === value?.palette) ? value.palette : 'classic',
    background: BACKGROUNDS.some((b) => b.value === value?.background) ? value.background : 'aurora',
    reducedEffects: value?.reducedEffects === true,
  };
}
