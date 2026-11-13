/**
 * 管理後台的權限總表（specs/cloud-admin.md），整個專案只在這裡定義一次。
 * 純函式、不碰資料庫；錯誤碼（403／409）由 admin.js 依情況決定。
 */

/**
 * 三種角色，順序與規格相同。
 */
export const ROLES = Object.freeze(['owner', 'admin', 'member']);

/**
 * 五種動作：查詢名單、新增成員、改暱稱、移除、調整角色。
 */
export const ACTIONS = Object.freeze(['view', 'add', 'editNickname', 'remove', 'setRole']);

/**
 * 「操作者 → 動作 → 允許的目標角色」。
 * add 的目標角色指「新增後的角色」，一律是成員；
 * 擁有者不能被移除或改角色，因此 remove／setRole 的目標不含 owner。
 */
const MATRIX = Object.freeze({
  owner: Object.freeze({
    view: ['owner', 'admin', 'member'],
    add: ['member'],
    editNickname: ['owner', 'admin', 'member'],
    remove: ['admin', 'member'],
    setRole: ['admin', 'member'],
  }),
  admin: Object.freeze({
    view: ['owner', 'admin', 'member'],
    add: ['member'],
    editNickname: ['member'],
    remove: [],
    setRole: [],
  }),
  member: Object.freeze({
    view: [],
    add: [],
    editNickname: [],
    remove: [],
    setRole: [],
  }),
});

/**
 * 是否為工作人員（擁有者或管理員），也就是能進後台的人。
 */
export function isStaff(role) {
  return role === 'owner' || role === 'admin';
}

/**
 * 判斷操作者能否對某個角色的目標執行動作。
 * self 為 true 表示目標就是操作者本人：管理員可以改自己的暱稱，
 * 但新增、移除、改角色都不能以自己為對象。
 */
export function can(actorRole, action, targetRole, { self = false } = {}) {
  if (!ROLES.includes(actorRole) || !ACTIONS.includes(action) || !ROLES.includes(targetRole)) return false;
  if (self) {
    if (targetRole !== actorRole) return false;
    if (action === 'view') return isStaff(actorRole);
    if (action === 'editNickname') return isStaff(actorRole);
    return false;
  }
  return MATRIX[actorRole][action].includes(targetRole);
}
