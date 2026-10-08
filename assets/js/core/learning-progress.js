/**
 * 給首頁與測驗 scope 使用的瞬時 v1 進度投影；不改持久摘要或排程狀態。
 */
import { GRADUATED_BOX } from './srs.js';

/**
 * 同來源只要有 FSRS，就用全部已建立能力的 mastered 狀態與最早 due 投影。
 * 未建立的能力不臆測；無 FSRS 的來源原樣保留，也不從孤立狀態補造進度。
 * 呼叫端提供一致快照；此處不取時間、不讀寫儲存、不重新計算 FSRS。
 */
export function projectLearningProgress({ progress, itemStates = {} }) {
  const sources = new Map();
  for (const state of Object.values(itemStates)) {
    const source = sources.get(state.sourceId) || { hasFsrs: false, allMastered: true, due: Infinity };
    source.hasFsrs = source.hasFsrs || state.schedulerName === 'fsrs';
    source.allMastered = source.allMastered && state.learningStatus === 'mastered';
    source.due = Math.min(source.due, state.due);
    sources.set(state.sourceId, source);
  }

  const items = Object.fromEntries(Object.entries(progress.items).map(([sourceId, record]) => {
    const source = sources.get(sourceId);
    return [sourceId, source?.hasFsrs
      ? { ...record, box: source.allMastered ? GRADUATED_BOX : 1, due: source.due }
      : { ...record }];
  }));
  return { ...progress, items };
}
