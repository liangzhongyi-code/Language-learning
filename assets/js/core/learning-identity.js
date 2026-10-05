/**
 * 能力狀態唯一身份契約；題面方向別名由事件入口正規化，持久狀態只存 canonical 方向。
 * 不依賴 schema／scheduler，讓初始化與匯入驗證能共用而不循環引用。
 */
import { LearningError } from './learning-errors.js';

const abilities = ['recognition', 'production', 'listening-recognition', 'listening-production', 'assembly', 'grammar'];

/**
 * key 同時隔離來源、能力與實際出題方向，禁止分隔符碰撞及顯示用方向別名。
 */
export function skillKeyFor({ sourceId, ability, direction }) {
  if (typeof sourceId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(sourceId)
    || ['constructor', 'prototype', '__proto__'].includes(sourceId)
    || !abilities.includes(ability) || !['zh2target', 'target2zh'].includes(direction)) {
    throw new LearningError('INVALID_DATA', '能力或實際出題方向不合法。');
  }
  const key = `${sourceId}:${ability}:${direction}`;
  if (key.length > 256) throw new LearningError('INVALID_DATA', '能力 key 過長。');
  return key;
}
