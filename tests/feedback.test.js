import test from 'node:test';
import assert from 'node:assert/strict';
import { LearningError } from '../assets/js/core/learning-errors.js';
import {
  FEEDBACK_PURPOSES, defaultFeedbackPrefs, mergeFeedbackPrefs, resolveFeedback,
} from '../assets/js/core/feedback-policy.js';

const ALL = Object.freeze({ vibrate: true, speech: true, audio: true });
const NO_VIBRATE = Object.freeze({ vibrate: false, speech: true, audio: true });
const isLearningError = (code) => (error) => error instanceof LearningError && error.code === code;
const reopen = (prefs) => mergeFeedbackPrefs(JSON.parse(JSON.stringify(prefs)));

test('O16 預設偏好：朗讀、音效、震動開啟，安靜模式關閉', () => {
  assert.deepEqual(defaultFeedbackPrefs(), { voiceEnabled: true, effectsEnabled: true, hapticsEnabled: true, quietMode: false });
  const a = defaultFeedbackPrefs();
  a.voiceEnabled = false;
  assert.equal(defaultFeedbackPrefs().voiceEnabled, true, '每次回傳獨立物件');
});

test('O16 語音、音效、震動、安靜模式各自保存，序列化往返（重開）後保留', () => {
  const saved = mergeFeedbackPrefs({ voiceEnabled: false, effectsEnabled: true, hapticsEnabled: false, quietMode: true });
  assert.deepEqual(reopen(saved), { voiceEnabled: false, effectsEnabled: true, hapticsEnabled: false, quietMode: true });
  const onlyEffectsOff = mergeFeedbackPrefs({ ...defaultFeedbackPrefs(), effectsEnabled: false });
  assert.deepEqual(reopen(onlyEffectsOff), { voiceEnabled: true, effectsEnabled: false, hapticsEnabled: true, quietMode: false },
    '關音效不連帶關語音');
});

test('O16 mergeFeedbackPrefs 只接受四個布林欄位，未知欄位忽略、非布林回預設', () => {
  assert.deepEqual(mergeFeedbackPrefs({ voiceEnabled: 'false', effectsEnabled: 0, hapticsEnabled: null, quietMode: 1, theme: 'dark', __proto__: { quietMode: true } }),
    defaultFeedbackPrefs());
  for (const bad of [null, undefined, 'x', 42, [], [true]]) assert.deepEqual(mergeFeedbackPrefs(bad), defaultFeedbackPrefs());
  const withGetter = Object.defineProperty({}, 'quietMode', { enumerable: true, get() { throw new Error('不可呼叫 getter'); } });
  assert.deepEqual(mergeFeedbackPrefs(withGetter), defaultFeedbackPrefs());
  assert.deepEqual(Object.keys(mergeFeedbackPrefs({ extra: true })).sort(), ['effectsEnabled', 'hapticsEnabled', 'quietMode', 'voiceEnabled']);
});

test('O16 安靜模式停止音效、震動與自動朗讀等非必要輸出', () => {
  const prefs = { ...defaultFeedbackPrefs(), quietMode: true };
  for (const purpose of ['answer-correct', 'answer-wrong', 'read-aloud']) {
    const result = resolveFeedback({ prefs, capabilities: ALL, purpose });
    assert.deepEqual(result, { sound: false, haptic: false, speak: false, needsUserChoice: false, reason: 'quiet-mode' }, purpose);
  }
});

test('O16 安靜模式下聽力題需要播放時明示使用者選擇，不偷播也不判錯', () => {
  const prefs = { ...defaultFeedbackPrefs(), quietMode: true };
  const result = resolveFeedback({ prefs, capabilities: ALL, purpose: 'listening-prompt' });
  assert.deepEqual(result, { sound: false, haptic: false, speak: false, needsUserChoice: true, reason: 'quiet-mode' });
  assert.equal(Object.hasOwn(result, 'correct'), false, '回饋沒有任何判題欄位');
  const played = resolveFeedback({ prefs, capabilities: ALL, purpose: 'listening-prompt', userInitiated: true });
  assert.deepEqual(played, { sound: false, haptic: false, speak: true, needsUserChoice: false, reason: 'user-initiated' },
    '使用者明示選擇播放後才朗讀');
});

test('O16 非安靜模式下聽力題自動播放；朗讀關閉或不支援語音時改為明示選擇', () => {
  const on = resolveFeedback({ prefs: defaultFeedbackPrefs(), capabilities: ALL, purpose: 'listening-prompt' });
  assert.deepEqual(on, { sound: false, haptic: false, speak: true, needsUserChoice: false, reason: 'enabled' });
  const voiceOff = resolveFeedback({ prefs: { ...defaultFeedbackPrefs(), voiceEnabled: false }, capabilities: ALL, purpose: 'listening-prompt' });
  assert.deepEqual(voiceOff, { sound: false, haptic: false, speak: false, needsUserChoice: true, reason: 'disabled' });
  const noSpeech = resolveFeedback({ prefs: defaultFeedbackPrefs(), capabilities: { ...ALL, speech: false }, purpose: 'listening-prompt' });
  assert.deepEqual(noSpeech, { sound: false, haptic: false, speak: false, needsUserChoice: true, reason: 'unsupported' });
  const tapNoSpeech = resolveFeedback({ prefs: defaultFeedbackPrefs(), capabilities: { ...ALL, speech: false }, purpose: 'listening-prompt', userInitiated: true });
  assert.deepEqual(tapNoSpeech, { sound: false, haptic: false, speak: false, needsUserChoice: true, reason: 'unsupported' },
    '裝置沒有語音時只能讓使用者跳過，不判錯');
});

test('O16 裝置不支援震動時 haptic=false 且不報錯，音效照常', () => {
  const result = resolveFeedback({ prefs: defaultFeedbackPrefs(), capabilities: NO_VIBRATE, purpose: 'answer-wrong' });
  assert.deepEqual(result, { sound: true, haptic: false, speak: false, needsUserChoice: false, reason: 'enabled' });
  const onlyHaptics = { voiceEnabled: false, effectsEnabled: false, hapticsEnabled: true, quietMode: false };
  assert.deepEqual(resolveFeedback({ prefs: onlyHaptics, capabilities: NO_VIBRATE, purpose: 'answer-correct' }),
    { sound: false, haptic: false, speak: false, needsUserChoice: false, reason: 'unsupported' });
  assert.deepEqual(resolveFeedback({ prefs: defaultFeedbackPrefs(), capabilities: {}, purpose: 'answer-correct' }),
    { sound: false, haptic: false, speak: false, needsUserChoice: false, reason: 'unsupported' }, '缺能力欄位視為不支援');
});

test('O16 各偏好獨立：只關音效仍震動，只關震動仍有音效', () => {
  const noEffects = resolveFeedback({ prefs: { ...defaultFeedbackPrefs(), effectsEnabled: false }, capabilities: ALL, purpose: 'answer-correct' });
  assert.deepEqual([noEffects.sound, noEffects.haptic], [false, true]);
  const noHaptics = resolveFeedback({ prefs: { ...defaultFeedbackPrefs(), hapticsEnabled: false }, capabilities: ALL, purpose: 'answer-correct' });
  assert.deepEqual([noHaptics.sound, noHaptics.haptic], [true, false]);
  const autoRead = resolveFeedback({ prefs: { ...defaultFeedbackPrefs(), voiceEnabled: false }, capabilities: ALL, purpose: 'read-aloud' });
  assert.deepEqual(autoRead, { sound: false, haptic: false, speak: false, needsUserChoice: false, reason: 'disabled' });
  const tap = resolveFeedback({ prefs: { ...defaultFeedbackPrefs(), voiceEnabled: false }, capabilities: ALL, purpose: 'read-aloud', userInitiated: true });
  assert.equal(tap.speak, true, '使用者主動點朗讀仍可播放');
});

test('O16 判題不受回饋影響：純函式不接收答案，答對與答錯的輸出管道相同', () => {
  assert.throws(() => resolveFeedback({ prefs: defaultFeedbackPrefs(), capabilities: ALL, purpose: 'answer-correct', answer: 'cat' }),
    isLearningError('INVALID_DATA'));
  assert.throws(() => resolveFeedback({ prefs: defaultFeedbackPrefs(), capabilities: ALL, purpose: 'answer-correct', correct: true }),
    isLearningError('INVALID_DATA'));
  const variants = [true, false];
  for (const quietMode of variants) for (const effectsEnabled of variants) for (const hapticsEnabled of variants) for (const vibrate of variants) {
    const prefs = Object.freeze({ voiceEnabled: true, effectsEnabled, hapticsEnabled, quietMode });
    const capabilities = Object.freeze({ vibrate, speech: true, audio: true });
    const right = resolveFeedback({ prefs, capabilities, purpose: 'answer-correct' });
    const wrong = resolveFeedback({ prefs, capabilities, purpose: 'answer-wrong' });
    assert.deepEqual(right, wrong);
    assert.deepEqual(Object.keys(right).sort(), ['haptic', 'needsUserChoice', 'reason', 'sound', 'speak']);
  }
});

test('O16 未知用途或不合法能力以 LearningError 拒絕', () => {
  assert.deepEqual([...FEEDBACK_PURPOSES], ['answer-correct', 'answer-wrong', 'listening-prompt', 'read-aloud']);
  assert.throws(() => resolveFeedback({ prefs: defaultFeedbackPrefs(), capabilities: ALL, purpose: 'celebrate' }), isLearningError('INVALID_DATA'));
  assert.throws(() => resolveFeedback({ prefs: defaultFeedbackPrefs(), capabilities: null, purpose: 'answer-correct' }), isLearningError('INVALID_DATA'));
  assert.throws(() => resolveFeedback({ prefs: defaultFeedbackPrefs(), capabilities: { vibrate: 'yes' }, purpose: 'answer-correct' }), isLearningError('INVALID_DATA'));
  assert.throws(() => resolveFeedback({ prefs: defaultFeedbackPrefs(), capabilities: ALL, purpose: 'read-aloud', userInitiated: 'yes' }), isLearningError('INVALID_DATA'));
});

test('O16 切安靜模式後重開並作答：偏好保留、無聲無震動、聽力題要使用者選擇', () => {
  const stored = JSON.stringify(mergeFeedbackPrefs({ voiceEnabled: true, effectsEnabled: false, hapticsEnabled: true, quietMode: true }));
  const prefs = mergeFeedbackPrefs(JSON.parse(stored));
  assert.deepEqual(prefs, { voiceEnabled: true, effectsEnabled: false, hapticsEnabled: true, quietMode: true });
  const answer = resolveFeedback({ prefs, capabilities: NO_VIBRATE, purpose: 'answer-correct' });
  assert.equal(answer.sound || answer.haptic || answer.speak, false);
  assert.equal(resolveFeedback({ prefs, capabilities: NO_VIBRATE, purpose: 'listening-prompt' }).needsUserChoice, true);
  const unquiet = mergeFeedbackPrefs({ ...prefs, quietMode: false });
  assert.deepEqual(resolveFeedback({ prefs: unquiet, capabilities: NO_VIBRATE, purpose: 'answer-correct' }),
    { sound: false, haptic: false, speak: false, needsUserChoice: false, reason: 'unsupported' }, '解除安靜後仍尊重各自偏好與裝置能力');
});
