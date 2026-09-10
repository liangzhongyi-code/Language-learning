import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  issueReportOf,
  encodeIssueCode,
  decodeIssueCode,
} from '../assets/js/core/issue-code.js';

const question = {
  kind: 'choice',
  sourceId: 'ja-w-0123',
  level: 2,
  direction: 'target2zh',
  prompt: '交通工具',
  promptLang: 'zh',
  optionLang: 'ja',
  options: [
    { text: '電車' },
    { text: '自転車' },
    { text: '飛行機' },
    { text: '船' },
  ],
  correctIndex: 0,
  answeredIndex: 1,
};

test('題目回報代碼：日文與中文說明可以完整來回', () => {
  const report = issueReportOf({
    session: { lang: 'ja', source: 'words', level: 2, direction: 'zh2target' },
    question,
    index: 6,
    settings: { direction: 'zh2target', kanjiMode: 'kana', readingAskIn: 'zh', scope: 'weak' },
    description: '正解似乎不只一個，請檢查「電車」。',
    now: 1788998400000,
  });
  const decoded = decodeIssueCode(encodeIssueCode(report));

  assert.deepEqual(decoded, report);
  assert.equal(decoded.question.sourceId, 'ja-w-0123');
  assert.equal(decoded.question.number, 7);
  assert.equal(decoded.question.direction, 'target2zh', '要記錄該題實際方向，不是設定畫面的舊值');
  assert.equal(decoded.settings.scope, 'weak');
  assert.equal(decoded.description, '正解似乎不只一個，請檢查「電車」。');
});

test('題目回報代碼：前後夾著聊天文字仍然讀得到', () => {
  const report = issueReportOf({
    session: { lang: 'ja', source: 'words', level: 2 },
    question,
    index: 0,
  });
  const code = encodeIssueCode(report);
  assert.equal(decodeIssueCode(`麻煩看這題：\n\`\`\`${code}\`\`\`。`).question.sourceId, question.sourceId);
  assert.equal(decodeIssueCode(`${code} please check`).question.sourceId, question.sourceId);
});

test('題目回報代碼：單一字元被改動會被校驗碼擋下', () => {
  const report = issueReportOf({
    session: { lang: 'ja', source: 'words', level: 2 },
    question,
    index: 0,
  });
  const code = encodeIssueCode(report);
  const at = code.indexOf(':') + 12;
  const replacement = code[at] === 'A' ? 'B' : 'A';
  const damaged = `${code.slice(0, at)}${replacement}${code.slice(at + 1)}`;
  assert.throws(() => decodeIssueCode(damaged), /不完整或被改動/);
});

test('題目回報會保存填空畫面與題型專屬內容', () => {
  const cloze = {
    kind: 'cloze',
    sourceId: 'ja-s-001',
    level: 1,
    direction: 'zh2target',
    prompt: '我喝水。',
    promptLang: 'zh',
    optionLang: 'ja',
    segments: [{ type: 'text', text: 'わたしは' }, { type: 'blank', blankIndex: 0 }],
    gap: '',
    bank: ['みずを', 'おちゃを'],
    bankRuby: ['水を', 'お茶を'],
    blanks: [{ answer: 'みずを' }],
    filled: ['みずを'],
    submitted: true,
    translation: 'I drink water.',
  };
  const report = issueReportOf({
    session: { lang: 'ja', source: 'cloze', level: 1, questions: [cloze] },
    question: cloze,
    index: 0,
  });

  assert.deepEqual(report.question.segments, cloze.segments);
  assert.equal(report.question.gap, '');
  assert.equal(report.question.translation, 'I drink water.');
  assert.deepEqual(report.question.options[0], { text: 'みずを', ruby: '水を' });
  assert.equal(report.settings.questionCount, 1);
});

test('題目回報只帶當前題目，不夾帶整局題目或學習紀錄', () => {
  const report = issueReportOf({
    session: { lang: 'ja', source: 'words', level: 2, questions: [question, { sourceId: '不該出現' }] },
    question,
    index: 0,
  });
  const raw = JSON.stringify(report);

  assert.doesNotMatch(raw, /不該出現/);
  assert.equal('progress' in report, false);
  assert.equal('stats' in report, false);
});

test('題目回報代碼：空白、錯誤內容與截斷代碼會明確擋下', () => {
  assert.throws(() => decodeIssueCode(''), /不是本站/);
  assert.throws(() => decodeIssueCode('hello'), /不是本站/);
  assert.throws(() => decodeIssueCode('langissue1:a'), /不完整/);
  assert.throws(() => encodeIssueCode({ version: 1 }), /格式不正確/);
});

test('題目回報說明最多保留 300 字，避免聊天軟體截斷整串代碼', () => {
  const report = issueReportOf({
    session: { lang: 'ja', source: 'words', level: 2 },
    question,
    index: 0,
    description: '字'.repeat(1200),
  });
  assert.equal(report.description.length, 300);
});
