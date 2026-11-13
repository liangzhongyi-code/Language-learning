/**
 * T05：權限總表。
 * 逐格對照 specs/cloud-admin.md 的總表：3 種操作者 × 5 種動作 × 3 種目標角色，
 * 另外窮舉「目標是自己」的情況（只有管理員改自己的暱稱會因此不同）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can, isStaff, ROLES, ACTIONS } from '../worker/src/roles.js';

/**
 * 規格總表的逐格展開。key 為「操作者 動作」，值為三種目標角色（owner／admin／member）是否允許。
 * - view：進入後台、查詢名單；與目標無關。
 * - add：新增的人一律是成員，因此只有目標為 member 的那一格可能允許。
 * - editNickname：擁有者可改任何人；管理員只能改成員（自己另外列在 SELF）。
 * - remove、setRole：只有擁有者，且擁有者本身不可被移除或改角色。
 */
const TABLE = {
  'owner view': { owner: true, admin: true, member: true },
  'owner add': { owner: false, admin: false, member: true },
  'owner editNickname': { owner: true, admin: true, member: true },
  'owner remove': { owner: false, admin: true, member: true },
  'owner setRole': { owner: false, admin: true, member: true },
  'admin view': { owner: true, admin: true, member: true },
  'admin add': { owner: false, admin: false, member: true },
  'admin editNickname': { owner: false, admin: false, member: true },
  'admin remove': { owner: false, admin: false, member: false },
  'admin setRole': { owner: false, admin: false, member: false },
  'member view': { owner: false, admin: false, member: false },
  'member add': { owner: false, admin: false, member: false },
  'member editNickname': { owner: false, admin: false, member: false },
  'member remove': { owner: false, admin: false, member: false },
  'member setRole': { owner: false, admin: false, member: false },
};

/**
 * 目標是操作者自己時的結果（目標角色必然等於操作者角色）。
 * 管理員可以改自己的暱稱；擁有者不能移除或降級自己；管理員不能移除或改自己的角色。
 */
const SELF = {
  'owner view': true,
  'owner add': false,
  'owner editNickname': true,
  'owner remove': false,
  'owner setRole': false,
  'admin view': true,
  'admin add': false,
  'admin editNickname': true,
  'admin remove': false,
  'admin setRole': false,
  'member view': false,
  'member add': false,
  'member editNickname': false,
  'member remove': false,
  'member setRole': false,
};

test('角色與動作的列舉與規格一致', () => {
  assert.deepEqual([...ROLES], ['owner', 'admin', 'member']);
  assert.deepEqual([...ACTIONS], ['view', 'add', 'editNickname', 'remove', 'setRole']);
});

test('權限總表：3 種操作者 × 5 種動作 × 3 種目標，逐格一致', () => {
  let cells = 0;
  for (const actor of ROLES) {
    for (const action of ACTIONS) {
      for (const target of ROLES) {
        const expected = TABLE[`${actor} ${action}`][target];
        assert.equal(can(actor, action, target), expected, `${actor} ${action} ${target}`);
        assert.equal(can(actor, action, target, { self: false }), expected, `${actor} ${action} ${target}（非本人）`);
        cells += 1;
      }
    }
  }
  assert.equal(cells, 45);
});

test('權限總表：目標是自己，逐格一致', () => {
  for (const actor of ROLES) {
    for (const action of ACTIONS) {
      assert.equal(can(actor, action, actor, { self: true }), SELF[`${actor} ${action}`], `${actor} ${action} 自己`);
    }
  }
});

test('self 與目標角色不一致時視為無效，一律拒絕', () => {
  assert.equal(can('admin', 'editNickname', 'owner', { self: true }), false);
  assert.equal(can('admin', 'editNickname', 'member', { self: true }), false);
});

test('未知的角色或動作一律拒絕', () => {
  assert.equal(can('superuser', 'view', 'member'), false);
  assert.equal(can(undefined, 'view', 'member'), false);
  assert.equal(can('owner', 'destroy', 'member'), false);
  assert.equal(can('owner', 'remove', 'guest'), false);
  assert.equal(can('owner', 'toString', 'member'), false);
});

test('isStaff：只有擁有者與管理員是工作人員', () => {
  assert.equal(isStaff('owner'), true);
  assert.equal(isStaff('admin'), true);
  assert.equal(isStaff('member'), false);
  assert.equal(isStaff(null), false);
  assert.equal(isStaff('constructor'), false);
});
