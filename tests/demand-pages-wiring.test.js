import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('demand pages：provider 接線與語言限定 legacy query', () => {
  const quiz = readFileSync(new URL('../assets/js/ui/quiz-view.js', import.meta.url), 'utf8');
  const daily = readFileSync(new URL('../assets/js/ui/daily-view.js', import.meta.url), 'utf8');
  assert.match(quiz, /dataProvider/);
  assert.match(quiz, /dataMeta/);
  assert.match(quiz, /legacyView\(lang\)/);
  assert.match(daily, /wordProvider/);
  assert.doesNotMatch(quiz + daily, /import.*data\/catalog/);
});
