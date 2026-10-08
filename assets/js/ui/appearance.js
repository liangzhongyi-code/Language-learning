import { PALETTES, BACKGROUNDS, normalizeAppearance } from '../core/appearance.js';
import { loadPrefs, savePrefs, PREFS_KEY, PREFS_IMPORTED_EVENT } from './prefs.js';

export const APPEARANCE_EVENT = 'lang-learn:appearance-changed';
let state = normalizeAppearance(loadPrefs());
let panel;
const motionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)');

function syncSystemEffects() {
  const note = panel?.querySelector('[data-system-effects]');
  if (note) note.hidden = !motionPreference?.matches;
}

/**
 * 不重建控制項，切換色票後鍵盤焦點仍留在原本的選項。
 */
function apply() {
  const root = document.documentElement;
  root.dataset.theme = state.theme;
  root.dataset.palette = state.palette;
  root.dataset.background = state.background;
  root.dataset.reducedEffects = String(state.reducedEffects);
  panel?.querySelectorAll('[data-appearance]').forEach((input) => {
    const key = input.dataset.appearance;
    input.checked = input.type === 'checkbox' ? state[key] : state[key] === input.value;
  });
  syncSystemEffects();
  window.dispatchEvent(new Event(APPEARANCE_EVENT));
}

export function setAppearance(key, value) {
  if (!Object.prototype.hasOwnProperty.call(state, key)) return;
  state = normalizeAppearance({ ...state, [key]: value });
  const saved = savePrefs({ ...loadPrefs(), ...state });
  apply();
  const status = panel?.querySelector('[data-appearance-status]');
  if (status) status.textContent = saved ? '已套用並儲存。' : '已套用；瀏覽器無法保存，重新開啟後可能恢復預設。';
}

function reload() {
  state = normalizeAppearance(loadPrefs());
  apply();
}

apply();
window.addEventListener(PREFS_IMPORTED_EVENT, reload);
if (motionPreference?.addEventListener) motionPreference.addEventListener('change', syncSystemEffects);
else motionPreference?.addListener?.(syncSystemEffects);
window.addEventListener('storage', (event) => {
  if (event.key === PREFS_KEY || event.key === null) reload();
});

export function appearanceHtml() {
  return `<details class="appearance" data-appearance-panel>
    <summary class="appearance-toggle">外觀</summary>
    <section class="appearance-panel" aria-label="外觀設定">
      <div class="appearance-head"><div><h2>你的學習空間</h2><p>換個色調，保持專注。</p></div>
        <button type="button" class="appearance-close" data-appearance-close aria-label="關閉外觀設定">×</button></div>
      <fieldset><legend>顯示模式</legend><div class="appearance-modes">
        <label><input type="radio" name="appearance-theme" data-appearance="theme" value="dark">深色</label>
        <label><input type="radio" name="appearance-theme" data-appearance="theme" value="light">淺色</label>
      </div></fieldset>
      <fieldset><legend>配色</legend><div class="appearance-grid">
        ${PALETTES.map((p) => `<label class="appearance-choice"><input type="radio" name="appearance-palette" data-appearance="palette" value="${p.value}"><span class="appearance-preview palette-${p.value}" aria-hidden="true"></span><span>${p.label}</span></label>`).join('')}
      </div></fieldset>
      <fieldset><legend>背景</legend><div class="appearance-grid backgrounds">
        ${BACKGROUNDS.map((b) => `<label class="appearance-choice"><input type="radio" name="appearance-background" data-appearance="background" value="${b.value}"><span class="appearance-preview preview-${b.value}" aria-hidden="true"></span><span>${b.label}</span><small>${b.note}</small></label>`).join('')}
      </div></fieldset>
      <label class="appearance-effects"><input type="checkbox" data-appearance="reducedEffects">降低特效</label>
      <p class="appearance-note">勾選後關閉動態、微塵與磨砂模糊，並降低柔光強度；測驗卡片一律使用實心底色。</p>
      <p class="appearance-note" data-system-effects hidden>系統目前已啟用「減少動態」：停止動畫、關閉磨砂模糊並降低柔光強度，保留靜態微塵；勾選「降低特效」仍會關閉微塵。</p>
      <p class="appearance-status" data-appearance-status role="status" aria-live="polite">選擇會自動保存，也會跟著備份匯出。</p>
    </section>
  </details>`;
}

/**
 * 非模態面板：不攔截頁面操作，Escape／關閉鍵回到入口，點外側收合。
 */
export function bindAppearance() {
  panel = document.querySelector('[data-appearance-panel]');
  if (!panel) return;
  apply();
  const fitPanel = () => {
    if (!panel.open) return;
    const content = panel.querySelector('.appearance-panel');
    const room = Math.max(0, window.innerHeight - content.getBoundingClientRect().top - 16);
    content.style.setProperty('--appearance-room', `${room}px`);
  };
  panel.addEventListener('toggle', fitPanel);
  window.addEventListener('resize', fitPanel);
  const close = (restoreFocus) => {
    panel.open = false;
    if (restoreFocus) panel.querySelector('summary').focus();
  };
  panel.addEventListener('change', (event) => {
    const input = event.target;
    if (input.dataset.appearance) setAppearance(input.dataset.appearance, input.type === 'checkbox' ? input.checked : input.value);
  });
  panel.querySelector('[data-appearance-close]').addEventListener('click', () => close(true));
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && panel.open) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  });
  document.addEventListener('click', (event) => {
    if (panel.open && !panel.contains(event.target)) close(false);
  });
}
