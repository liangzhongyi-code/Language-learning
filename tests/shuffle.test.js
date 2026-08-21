import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shuffle, sample } from '../assets/js/core/shuffle.js';

/**
 * 產生一個回傳固定序列的假亂數函式。
 * 用完會從頭循環，讓測試無論呼叫幾次都有可預期的結果。
 */
function fakeRng(sequence) {
  let i = 0;
  return () => sequence[i++ % sequence.length];
}

test('shuffle：不改變原陣列', () => {
  const arr = [1, 2, 3, 4, 5];
  const snapshot = [...arr];
  shuffle(arr, fakeRng([0.9, 0.1, 0.5, 0.3]));
  assert.deepEqual(arr, snapshot, '原陣列不得被就地改動');
});

test('shuffle：回傳的是新陣列', () => {
  const arr = [1, 2, 3];
  const out = shuffle(arr);
  assert.notEqual(out, arr, '必須回傳新陣列而非同一個參考');
});

test('shuffle：不遺失也不新增元素', () => {
  const arr = ['a', 'b', 'c', 'd', 'e', 'f'];
  const out = shuffle(arr, fakeRng([0.7, 0.2, 0.95, 0.05, 0.44]));
  assert.equal(out.length, arr.length);
  assert.deepEqual([...out].sort(), [...arr].sort(), '元素集合必須相同');
});

test('shuffle：固定亂數源產生穩定結果', () => {
  const arr = [1, 2, 3, 4, 5, 6, 7, 8];
  const seq = [0.13, 0.87, 0.42, 0.61, 0.05, 0.78, 0.33];
  const a = shuffle(arr, fakeRng(seq));
  const b = shuffle(arr, fakeRng(seq));
  assert.deepEqual(a, b, '同樣的亂數序列必須產生同樣的排列');
});

test('shuffle：空陣列與單元素不出錯', () => {
  assert.deepEqual(shuffle([]), []);
  assert.deepEqual(shuffle([9]), [9]);
});

test('shuffle：預設使用 Math.random 時仍是合法排列', () => {
  const arr = Array.from({ length: 20 }, (_, i) => i);
  const out = shuffle(arr);
  assert.deepEqual([...out].sort((x, y) => x - y), arr);
});

test('sample：取出指定數量且不重複', () => {
  const arr = Array.from({ length: 30 }, (_, i) => i);
  const out = sample(arr, 8, fakeRng([0.5, 0.2, 0.9, 0.1, 0.75, 0.31, 0.66]));
  assert.equal(out.length, 8);
  assert.equal(new Set(out).size, 8, '取樣結果不得有重複元素');
  assert.ok(out.every((x) => arr.includes(x)));
});

test('sample：要求數量超過來源時取全部', () => {
  const arr = [1, 2, 3];
  const out = sample(arr, 10);
  assert.equal(out.length, 3);
  assert.deepEqual([...out].sort(), [1, 2, 3]);
});

test('sample：數量為 0 或負數時回傳空陣列', () => {
  const arr = [1, 2, 3];
  assert.deepEqual(sample(arr, 0), []);
  assert.deepEqual(sample(arr, -5), []);
});
