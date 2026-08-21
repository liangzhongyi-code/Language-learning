import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speakTextOf } from '../assets/js/core/speech-text.js';

/**
 * 這條規則原本散在 quiz-engine、vocab-view、grammar-view 三處各寫一份，
 * 其中兩份在 ui 層所以測不到。收進 core 之後在這裡一次測完。
 */

const JA_WORD = { target: '雨', reading: 'あめ', romaji: 'ame' };
const EN_WORD = { target: 'rain', reading: null, romaji: null };

test('日文送假名讀音而不是漢字', () => {
  assert.equal(speakTextOf(JA_WORD, 'ja'), 'あめ', '送漢字會被語音引擎唸成別的讀法');
});

test('英文送目標語言寫法', () => {
  assert.equal(speakTextOf(EN_WORD, 'en'), 'rain');
});

test('日文沒有讀音時退回目標語言寫法而不是空字串', () => {
  assert.equal(speakTextOf({ target: 'バドミントン', reading: null }, 'ja'), 'バドミントン');
  assert.equal(speakTextOf({ target: 'ラーメン', reading: '' }, 'ja'), 'ラーメン');
});

test('整句資料同樣適用', () => {
  const sentence = { target: '私はコーヒーを飲みます', reading: 'わたしはコーヒーをのみます' };
  assert.equal(speakTextOf(sentence, 'ja'), 'わたしはコーヒーをのみます');
  assert.equal(speakTextOf({ target: 'I drink coffee', reading: null }, 'en'), 'I drink coffee');
});

test('資料為 null 或欄位缺漏時回傳空字串而不是拋錯', () => {
  assert.equal(speakTextOf(null, 'ja'), '');
  assert.equal(speakTextOf(undefined, 'en'), '');
  assert.equal(speakTextOf({}, 'ja'), '');
  assert.equal(speakTextOf({}, 'en'), '');
});

test('未知語言視同不需要讀音欄位', () => {
  assert.equal(speakTextOf({ target: 'hola', reading: 'oh-la' }, 'es'), 'hola');
});
