/**
 * 每日能力複習的人工題面選擇器。缺少精確匹配時保留待複習項目並拒絕出題，
 * 不以辨認題或其他來源／方向／級別遞補；回傳候選題面須由 caller 原子保存。
 */
import { buildPracticeQuestion, PRACTICE_MODES } from './practice-engine.js';
import { normalizeDailyLevel } from './daily-plan.js';
import { reviewIdentity } from './review-events.js';
import { skillKeyFor } from './learning-identity.js';
import { LearningError } from './learning-errors.js';

/**
 * daily-view 應以此 safe enum 呈現固定缺題文案，不把缺題當成保存失敗或顯示原始例外。
 */
export const DAILY_PRACTICE_UNAVAILABLE = 'DAILY_PRACTICE_UNAVAILABLE';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const fail = (code, message) => { throw new LearningError(code, message); };
const canonical = (direction, lang) => direction === `${lang}-zh` ? 'target2zh'
  : direction === `zh-${lang}` ? 'zh2target' : direction;

function canonicalKey(key, sourceId, lang) {
  const prefix = `${sourceId}:`;
  if (typeof key !== 'string' || !key.startsWith(prefix)) fail('INVALID_DATA', '能力 key 與題次來源不一致。');
  const parts = key.slice(prefix.length).split(':');
  if (parts.length !== 2) fail('INVALID_DATA', '能力 key 不合法。');
  return skillKeyFor({ sourceId, ability: parts[0], direction: canonical(parts[1], lang) });
}

/**
 * entry 與 state 取自同一交易讀取；lang／level 取自該 plan，不取目前畫面的可變設定。
 * assembly 的多個人工題以 id 字典序選第一筆，與陣列順序無關；rng 只供首次題面洗牌。
 * 已保存的 questionSnapshot 永遠優先，核對身份後回傳複本，不再讀題庫或呼叫 rng。
 */
export function buildDailyPracticeQuestion({ items, entry, state = null, lang, level, rng }) {
  const wantedLevel = normalizeDailyLevel(lang, level);
  if (!entry || typeof entry.sourceId !== 'string' || !entry.sourceId.startsWith(`${lang}-`)) {
    fail('INVALID_DATA', '每日題次與語言不一致。');
  }
  const sourceId = entry.sourceId;
  const saved = entry.questionSnapshot;
  if (!state && !saved) fail(DAILY_PRACTICE_UNAVAILABLE, '此題次缺少可確認的能力，不能改出辨認題。');
  const identity = state || saved;
  if (identity.sourceId !== sourceId || (identity.lang !== undefined && identity.lang !== lang)
    || (identity.level !== undefined && normalizeDailyLevel(lang, identity.level) !== wantedLevel)) {
    fail('INVALID_DATA', '每日能力與題次來源、語言或級別不一致。');
  }
  const direction = canonical(identity.direction, lang);
  const skillKey = skillKeyFor({ sourceId, ability: identity.ability, direction });
  if ((entry.lang !== undefined && entry.lang !== lang)
    || (entry.level !== undefined && normalizeDailyLevel(lang, entry.level) !== wantedLevel)
    || (entry.ability !== undefined && entry.ability !== identity.ability)
    || (entry.direction !== undefined && canonical(entry.direction, lang) !== direction)) {
    fail('INVALID_DATA', '每日題次的明示能力、方向、語言或級別不一致。');
  }
  for (const row of [entry, state]) {
    if (row && row.skillKey !== undefined && row.skillKey !== null
      && canonicalKey(row.skillKey, sourceId, lang) !== skillKey) fail('INVALID_DATA', '每日能力 key 與題次不一致。');
  }
  function checkQuestion(question) {
    const resolved = reviewIdentity({ question });
    const spec = own(PRACTICE_MODES, question.practiceMode) ? PRACTICE_MODES[question.practiceMode] : null;
    if (!spec || resolved.skillKey !== skillKey || question.lang !== lang
      || normalizeDailyLevel(lang, question.level) !== wantedLevel
      || question.ability !== spec.ability || canonical(question.direction, lang) !== spec.direction
      || question.kind !== spec.questionMode || question.questionMode !== spec.questionMode || !question.answerKey
      || (lang === 'en' && question.practiceMode === 'kana')) {
      fail('INVALID_DATA', '保存的人工題面與每日能力不一致，不能重新選題取代。');
    }
    return JSON.parse(JSON.stringify(question));
  }
  if (saved !== undefined && saved !== null) return checkQuestion(saved);
  if (!Array.isArray(items)) fail('INVALID_DATA', '人工練習題庫必須是陣列。');
  const seen = new Set();
  const candidates = items.filter(item => {
    if (!item || typeof item.id !== 'string' || item.sourceId !== sourceId || !item.id.startsWith(`${lang}-`)
      || !own(PRACTICE_MODES, item.mode) || (item.lang !== undefined && item.lang !== lang)) return false;
    const spec = PRACTICE_MODES[item.mode];
    if (spec.ability !== identity.ability || spec.direction !== direction
      || (item.ability !== undefined && item.ability !== spec.ability)
      || (item.direction !== undefined && canonical(item.direction, lang) !== direction)
      || normalizeDailyLevel(lang, item.level) !== wantedLevel || (lang === 'en' && item.mode === 'kana')) return false;
    if (seen.has(item.id)) fail('INVALID_DATA', '匹配的人工題含重複 id，無法穩定選題。');
    seen.add(item.id);
    return true;
  });
  candidates.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (!candidates.length) fail(DAILY_PRACTICE_UNAVAILABLE, '此來源、能力、方向與級別尚無匹配的人工題；待複習紀錄仍保留。');
  return checkQuestion(buildPracticeQuestion(candidates[0], rng));
}
