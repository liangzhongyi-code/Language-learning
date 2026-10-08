import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * 接線護欄不是操作驗收；真正流程另由 quiz-progress Chromium suite 驗證。
 */
test('F16：正式自由測驗必須使用逐題服務，不可在結果頁整局重計', () => {
  const source = readFileSync(new URL('../assets/js/ui/quiz-view.js', import.meta.url), 'utf8');
  assert.match(source, /createQuizService/);
  assert.doesNotMatch(source, /store\.recordQuizSession\(/);
  assert.match(source, /data-resume-quiz/);
  assert.match(source, /data-question-save/);
  assert.match(source, /data-question-retry/);
});
