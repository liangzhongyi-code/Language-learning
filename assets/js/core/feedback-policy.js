/**
 * 音效、語音朗讀與震動回饋的純政策。只決定「要不要輸出」，不接收答案、
 * 不回傳任何對錯欄位，因此回饋設定或裝置能力永遠不會改變判題結果。
 */
import { LearningError } from './learning-errors.js';

/**
 * 支援的回饋用途：答對、答錯、聽力題題目播放、自動朗讀。
 */
export const FEEDBACK_PURPOSES = Object.freeze(['answer-correct', 'answer-wrong', 'listening-prompt', 'read-aloud']);

const PREF_KEYS = Object.freeze(['voiceEnabled', 'effectsEnabled', 'hapticsEnabled', 'quietMode']);
const CAPABILITY_KEYS = Object.freeze(['vibrate', 'speech', 'audio']);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = (message) => { throw new LearningError('INVALID_DATA', message); };

/**
 * reason 代碼對應的繁中說明，供 UI 顯示；分支判定請用代碼本身。
 */
export const FEEDBACK_REASON_TEXT = Object.freeze({
  enabled: '依目前設定輸出回饋。',
  disabled: '此回饋已在設定中關閉。',
  unsupported: '此裝置不支援這項回饋。',
  'quiet-mode': '安靜模式中，已停止音效、震動與自動朗讀。',
  'user-initiated': '依你的選擇播放。',
});

/**
 * 預設回饋偏好：朗讀、音效、震動開啟，安靜模式關閉。每次回傳獨立物件。
 */
export function defaultFeedbackPrefs() {
  return { voiceEnabled: true, effectsEnabled: true, hapticsEnabled: true, quietMode: false };
}

/**
 * 讀取自有、可列舉的資料欄位值；accessor 不呼叫 getter，一律視為不存在。
 */
function ownValue(source, key) {
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return undefined;
  return descriptor.value;
}

/**
 * 合併已保存的偏好：只接受四個布林欄位，其他欄位忽略，缺少或非布林回到預設。
 * 結果可直接 JSON 序列化保存，重開後再經本函式讀回仍相同。
 */
export function mergeFeedbackPrefs(stored) {
  const merged = defaultFeedbackPrefs();
  if (!object(stored)) return merged;
  for (const key of PREF_KEYS) {
    const value = ownValue(stored, key);
    if (typeof value === 'boolean') merged[key] = value;
  }
  return merged;
}

/**
 * 裝置能力缺欄位視為不支援；有值時必須是布林，避免把字串 "false" 當成支援。
 */
function readCapabilities(capabilities) {
  if (!object(capabilities)) invalid('裝置能力必須是物件。');
  const result = {};
  for (const key of CAPABILITY_KEYS) {
    const value = ownValue(capabilities, key);
    if (value !== undefined && typeof value !== 'boolean') invalid(`裝置能力 ${key} 必須是布林值。`);
    result[key] = value === true;
  }
  return result;
}

/**
 * 依偏好與能力決定單一管道：關閉→disabled、裝置不支援→unsupported、否則 enabled。
 */
const channel = (wanted, supported) => (!wanted ? 'disabled' : supported ? 'enabled' : 'unsupported');

/**
 * 有任何輸出即 enabled；否則只要有偏好開啟卻被裝置擋下就是 unsupported，其餘為 disabled。
 */
function summarize(states) {
  if (states.includes('enabled')) return 'enabled';
  return states.includes('unsupported') ? 'unsupported' : 'disabled';
}

const output = (sound, haptic, speak, needsUserChoice, reason) => ({ sound, haptic, speak, needsUserChoice, reason });

/**
 * 決定一次回饋要輸出哪些管道，回傳 { sound, haptic, speak, needsUserChoice, reason }。
 * 安靜模式停止音效、震動與自動朗讀；聽力題需要播放時不偷播，改回傳 needsUserChoice
 * 讓 UI 明示「播放／跳過」，跳過不判錯。userInitiated 表示使用者剛主動按下播放。
 * 不接收答案或對錯，傳入未知參數一律拒絕。
 */
export function resolveFeedback({ prefs, capabilities, purpose, userInitiated = false, ...other }) {
  if (Object.keys(other).length) invalid('回饋政策不接收答案或其他未知參數。');
  if (!FEEDBACK_PURPOSES.includes(purpose)) invalid('未知的回饋用途。');
  if (typeof userInitiated !== 'boolean') invalid('userInitiated 必須是布林值。');
  const p = mergeFeedbackPrefs(prefs);
  const can = readCapabilities(capabilities);

  if (purpose === 'answer-correct' || purpose === 'answer-wrong') {
    if (p.quietMode) return output(false, false, false, false, 'quiet-mode');
    const sound = channel(p.effectsEnabled, can.audio);
    const haptic = channel(p.hapticsEnabled, can.vibrate);
    return output(sound === 'enabled', haptic === 'enabled', false, false, summarize([sound, haptic]));
  }

  if (userInitiated) {
    if (!can.speech) return output(false, false, false, purpose === 'listening-prompt', 'unsupported');
    return output(false, false, true, false, 'user-initiated');
  }

  if (purpose === 'listening-prompt') {
    if (!can.speech) return output(false, false, false, true, 'unsupported');
    if (p.quietMode) return output(false, false, false, true, 'quiet-mode');
    if (!p.voiceEnabled) return output(false, false, false, true, 'disabled');
    return output(false, false, true, false, 'enabled');
  }

  if (p.quietMode) return output(false, false, false, false, 'quiet-mode');
  const speak = channel(p.voiceEnabled, can.speech);
  return output(false, false, speak === 'enabled', false, speak);
}
