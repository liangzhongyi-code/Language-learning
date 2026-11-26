/**
 * 外觀設定的合法值。匯入舊備份或手改資料時，逐欄回到安全預設。
 */
export const PALETTES = [
  { value: 'classic', label: '經典靛藍', note: '沉靜專注' },
  { value: 'midnight', label: '深海星夜', note: '冷靜深邃' },
  { value: 'forest', label: '抹茶森綠', note: '和風護眼' },
  { value: 'warm', label: '溫潤和紙', note: '紙本手感' },
  { value: 'sakura', label: '櫻霞暮粉', note: '日系柔和' },
  { value: 'violet', label: '暮紫星雲', note: '俐落現代' },
  { value: 'sunset', label: '琥珀晚霞', note: '明快溫暖' },
  { value: 'mono', label: '極簡墨韻', note: '零干擾閱讀' },
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
