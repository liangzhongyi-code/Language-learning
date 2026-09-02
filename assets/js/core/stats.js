/**
 * 成績計算與跨局統計。
 *
 * 這個模組刻意不直接引用 localStorage，而是接受一個 storage 介面參數。
 * 這同時解決兩件事：測試可以注入假物件驗出降級路徑，
 * 而無痕模式或容量已滿導致的例外也能在同一條路徑上被吃掉。
 *
 * 「這題算不算作答完畢／算不算答對」不在這裡自己判斷，一律問 quiz-engine——
 * 選擇題看選項索引、填空題看提交狀態，規則寫兩份遲早會分家。
 */

import { isAnswered, isCorrect, clozeSentence } from './quiz-engine.js';

/**
 * localStorage 的 key。版本號寫在 key 與內容裡，日後改格式只要換版本號即可安全丟棄舊資料
 */
export const STATS_KEY = 'lang-learn.stats.v1';

/**
 * 目前的統計結構版本
 */
export const SCHEMA_VERSION = 1;

/**
 * 初始統計物件
 */
export function emptyStats() {
  return { schemaVersion: SCHEMA_VERSION, byScope: {} };
}

/**
 * 統計的分組鍵，以「語言 × 題源」為粒度
 */
export function scopeKey(lang, source) {
  return `${lang}:${source}`;
}

/**
 * 正確率，回傳 0-100 的整數。
 * 分母為 0 或不合法時一律回傳 0，絕不讓 NaN 流到畫面上。
 */
export function calcAccuracy(correct, total) {
  if (!Number.isFinite(total) || total <= 0) return 0;
  if (!Number.isFinite(correct) || correct <= 0) return 0;
  return Math.round((correct / total) * 100);
}

/**
 * 一局是否每一題都作答完畢。
 * 未完成的局不寫入統計，避免中途離開污染正確率。
 */
export function isComplete(session) {
  const qs = session?.questions || [];
  return qs.length > 0 && qs.every(isAnswered);
}

/**
 * 錯題檢討要顯示的「你選的」文字。
 * 沒作答回傳 null，讓畫面顯示「沒選」而不是空字串。
 */
function chosenTextOf(q) {
  if (!isAnswered(q)) return null;
  if (q.kind === 'cloze') return clozeSentence(q, (i) => q.filled[i]);
  return q.options?.[q.answeredIndex]?.text ?? null;
}

/**
 * 錯題檢討要顯示的正解文字。
 *
 * 填空題還原成完整句子，不是只把空格的答案串起來——
 * 「私を」這種脫離句子的片段看不出錯在哪，「私はお酒を飲みません」才看得懂。
 */
function correctTextOf(q) {
  if (q.kind === 'cloze') return clozeSentence(q, (i) => q.blanks[i].answer);
  return q.options?.[q.correctIndex]?.text ?? null;
}

/**
 * 把一局的作答結果整理成結果畫面要的資料。
 * 未作答的題目算錯，並以 chosenText 為 null 表示「沒選」。
 */
export function summarize(session) {
  const questions = session?.questions || [];
  const wrongList = [];
  let correct = 0;

  for (const q of questions) {
    if (isCorrect(q)) {
      correct += 1;
      continue;
    }
    wrongList.push({
      sourceId: q.sourceId,
      prompt: q.prompt,
      /**
       * 題目脫離情境就看不懂：閱讀題的 prompt 是「他怎麼從車站到公司？」，
       * 情境題的判斷依據整個在場合描述裡。檢討畫面只印 prompt 的話，
       * 八篇短文各四題會變成一串認不出屬於哪一篇的問句。
       */
      title: q.title ?? null,
      context: q.context ?? null,
      chosenText: chosenTextOf(q),
      correctText: correctTextOf(q),
      note: q.note ?? null,
      direction: q.direction ?? null,
      optionLang: q.optionLang ?? null,
      /**
       * 目標語言的朗讀文字。
       * 不能拿 correctText 代替——外翻中的題目正解是中文，
       * 而日文的 correctText 是漢字，直接送語音引擎會被唸錯。
       */
      speakText: q.speakText ?? null,
    });
  }

  return {
    total: questions.length,
    correct,
    accuracy: calcAccuracy(correct, questions.length),
    wrongList,
  };
}

/**
 * 讀取統計。
 * 內容損毀、版本不符、結構不對、storage 本身讀取失敗——
 * 四種情況一律安靜地回到初始狀態，不讓頁面因為一筆爛資料而掛掉。
 */
export function loadStats(storage) {
  let raw;
  try {
    raw = storage?.getItem?.(STATS_KEY);
  } catch {
    return emptyStats();
  }
  if (!raw) return emptyStats();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyStats();
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    parsed.schemaVersion !== SCHEMA_VERSION ||
    typeof parsed.byScope !== 'object' ||
    parsed.byScope === null ||
    Array.isArray(parsed.byScope)
  ) {
    return emptyStats();
  }

  return { schemaVersion: SCHEMA_VERSION, byScope: { ...parsed.byScope } };
}

/**
 * 寫入統計。寫失敗時回傳 false，呼叫端可據此提示「本次成績無法保存」，
 * 但測驗流程本身不受影響。
 */
export function saveStats(storage, stats) {
  /**
   * 先確認真的有東西可以寫。
   * `storage?.setItem?.()` 在 storage 是 undefined 時會靜靜地什麼都不做然後回傳
   * undefined——於是這個函式回報 true，而畫面上那句「這次的成績無法保存」
   * 永遠不會出現。停用 localStorage 的瀏覽器正好走這條路。
   */
  if (typeof storage?.setItem !== 'function') return false;
  try {
    storage.setItem(STATS_KEY, JSON.stringify(stats));
    return true;
  } catch {
    return false;
  }
}

/**
 * 清除統計
 */
export function clearStats(storage) {
  /* 與 saveStats 同一道守衛：沒有東西可刪就不要回報成功 */
  if (typeof storage?.removeItem !== 'function') return false;
  try {
    storage.removeItem(STATS_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * 把一局的成績累加進統計，回傳新的統計物件（不就地改動來源）
 */
export function applySession(stats, lang, source, summary) {
  const key = scopeKey(lang, source);
  const prev = stats?.byScope?.[key] || { answered: 0, correct: 0, sessions: 0 };
  return {
    schemaVersion: SCHEMA_VERSION,
    byScope: {
      ...(stats?.byScope || {}),
      [key]: {
        answered: prev.answered + (summary?.total || 0),
        correct: prev.correct + (summary?.correct || 0),
        sessions: prev.sessions + 1,
      },
    },
  };
}

/**
 * 取某個語言的加總統計，供語言首頁的摘要使用。
 * hasData 為 false 時 UI 應顯示引導文案而不是 0%。
 */
export function statsOfLang(stats, lang) {
  const entries = Object.entries(stats?.byScope || {}).filter(([k]) => k.startsWith(`${lang}:`));
  const answered = entries.reduce((n, [, v]) => n + (v.answered || 0), 0);
  const correct = entries.reduce((n, [, v]) => n + (v.correct || 0), 0);
  const sessions = entries.reduce((n, [, v]) => n + (v.sessions || 0), 0);
  return {
    hasData: entries.length > 0,
    answered,
    correct,
    sessions,
    accuracy: calcAccuracy(correct, answered),
  };
}
