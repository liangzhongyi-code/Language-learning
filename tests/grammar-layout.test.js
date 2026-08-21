import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLayout } from '../assets/js/core/grammar-layout.js';

/**
 * 英文：時間區塊在中文是第 2 塊、在英文跑到句尾
 */
const EN = {
  id: 'en-s-001',
  zh: '我今天去打羽毛球',
  target: 'I play badminton today',
  chunks: [
    { role: 'subject', zh: '我', target: 'I', zhIndex: 0 },
    { role: 'verb', zh: '去打', target: 'play', zhIndex: 2 },
    { role: 'object', zh: '羽毛球', target: 'badminton', zhIndex: 3 },
    { role: 'time', zh: '今天', target: 'today', zhIndex: 1 },
  ],
};

/**
 * 日文：助詞獨立成塊、動詞墊底
 */
const JA = {
  id: 'ja-s-001',
  zh: '我今天去打羽毛球',
  target: '私は今日バドミントンをします',
  chunks: [
    { role: 'subject', zh: '我', target: '私', zhIndex: 0 },
    { role: 'particle', zh: '', target: 'は', zhIndex: 4 },
    { role: 'time', zh: '今天', target: '今日', zhIndex: 1 },
    { role: 'object', zh: '羽毛球', target: 'バドミントン', zhIndex: 3 },
    { role: 'particle', zh: '', target: 'を', zhIndex: 5 },
    { role: 'verb', zh: '去打', target: 'します', zhIndex: 2 },
  ],
};

/**
 * 中英語序完全相同的句子
 */
const SAME = {
  id: 'en-s-002',
  zh: '我吃蘋果',
  target: 'I eat apples',
  chunks: [
    { role: 'subject', zh: '我', target: 'I', zhIndex: 0 },
    { role: 'verb', zh: '吃', target: 'eat', zhIndex: 1 },
    { role: 'object', zh: '蘋果', target: 'apples', zhIndex: 2 },
  ],
};

test('buildLayout：目標語言排照 chunks 陣列順序', () => {
  const { targetRow } = buildLayout(EN);
  assert.deepEqual(targetRow.map((b) => b.text), ['I', 'play', 'badminton', 'today']);
});

test('buildLayout：中文排照 zhIndex 排序', () => {
  const { zhRow } = buildLayout(EN);
  assert.deepEqual(zhRow.map((b) => b.text), ['我', '今天', '去打', '羽毛球']);
});

test('buildLayout：兩排各自能還原完整句子', () => {
  const { zhRow, targetRow } = buildLayout(EN);
  assert.equal(zhRow.map((b) => b.text).join(''), EN.zh);
  assert.equal(targetRow.map((b) => b.text).join(' '), EN.target);
});

test('buildLayout：日文助詞只出現在日文排，中文排完全不顯示', () => {
  const { zhRow, targetRow } = buildLayout(JA);
  assert.ok(targetRow.some((b) => b.isParticle), '日文排必須有助詞區塊');
  assert.equal(zhRow.filter((b) => b.isParticle).length, 0, '中文排不得出現助詞');
  assert.deepEqual(zhRow.map((b) => b.text), ['我', '今天', '去打', '羽毛球']);
});

test('buildLayout：日文排串接可還原原句', () => {
  const { targetRow } = buildLayout(JA);
  assert.equal(targetRow.map((b) => b.text).join(''), JA.target);
});

test('buildLayout：只標記真正被移動的區塊', () => {
  const { targetRow } = buildLayout(EN);
  const moved = targetRow.filter((b) => b.moved).map((b) => b.role);
  assert.deepEqual(moved, ['time'], `只有時間區塊該被標記，實際：${moved}`);
});

test('buildLayout：語序完全相同時沒有任何標記', () => {
  const { zhRow, targetRow } = buildLayout(SAME);
  assert.ok(targetRow.every((b) => !b.moved), '不該有多餘的語序標記');
  assert.ok(zhRow.every((b) => !b.moved));
});

test('buildLayout：日文動詞移到句尾會被標記', () => {
  const { targetRow } = buildLayout(JA);
  const moved = targetRow.filter((b) => b.moved).map((b) => b.role);
  assert.equal(moved.length, 1, `應只標記一塊，實際：${moved}`);
  assert.ok(['verb', 'object'].includes(moved[0]));
});

test('buildLayout：助詞本身不會被標記為語序改變', () => {
  const { targetRow } = buildLayout(JA);
  assert.ok(targetRow.filter((b) => b.isParticle).every((b) => !b.moved));
});

test('buildLayout：兩排的同一角色顏色一致', () => {
  const { zhRow, targetRow } = buildLayout(EN);
  for (const zb of zhRow) {
    const tb = targetRow.find((b) => b.chunkIndex === zb.chunkIndex);
    assert.equal(zb.color, tb.color, `${zb.role} 的顏色在兩排必須一致`);
    assert.equal(zb.label, tb.label);
  }
});

test('buildLayout：每一塊都有角色的中文標籤與顏色', () => {
  const { targetRow } = buildLayout(JA);
  for (const b of targetRow) {
    assert.ok(b.label && b.label.trim(), `${b.role} 缺中文標籤`);
    /* 顏色一律以 CSS 變數表示，實際色碼只存在 theme.css，全站單一來源 */
    assert.match(b.color, /^var\(--r-[a-z]+\)$/, `${b.role} 的顏色應為 CSS 變數參照`);
  }
});

test('buildLayout：hasOrderDiff 標示整句是否有語序落差', () => {
  assert.equal(buildLayout(EN).hasOrderDiff, true);
  assert.equal(buildLayout(SAME).hasOrderDiff, false);
});

test('buildLayout：空 chunks 不爆', () => {
  const r = buildLayout({ id: 'x', zh: '', target: '', chunks: [] });
  assert.deepEqual(r.zhRow, []);
  assert.deepEqual(r.targetRow, []);
  assert.equal(r.hasOrderDiff, false);
});
