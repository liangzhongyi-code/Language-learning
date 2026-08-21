/**
 * 成績計算與跨局統計。
 *
 * 這個模組刻意不直接引用 localStorage，而是接受一個 storage 介面參數。
 * 這同時解決兩件事：測試可以注入假物件驗出降級路徑，
 * 而無痕模式或容量已滿導致的例外也能在同一條路徑上被吃掉。
 */

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
  return qs.length > 0 && qs.every((q) => q.answeredIndex !== null && q.answeredIndex !== undefined);
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
    if (q.answeredIndex === q.correctIndex) {
      correct += 1;
      continue;
    }
    const chosen = q.options?.[q.answeredIndex];
    wrongList.push({
      sourceId: q.sourceId,
      prompt: q.prompt,
      chosenText: chosen ? chosen.text : null,
      correctText: q.options?.[q.correctIndex]?.text ?? null,
      note: q.note ?? null,
      direction: q.direction ?? null,
      optionLang: q.optionLang ?? null,
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
  try {
    storage?.setItem?.(STATS_KEY, JSON.stringify(stats));
    return true;
  } catch {
    return false;
  }
}

/**
 * 清除統計
 */
export function clearStats(storage) {
  try {
    storage?.removeItem?.(STATS_KEY);
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
