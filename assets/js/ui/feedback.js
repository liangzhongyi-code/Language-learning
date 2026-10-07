/**
 * 作答回饋的輸出端：音效（Web Audio 合成短音，不需外部音檔）、震動與朗讀許可。
 * 開關與安靜模式的判斷全部在 core/feedback-policy；這裡只依結果實際輸出，不影響判題。
 */
import { resolveFeedback, mergeFeedbackPrefs } from '../core/feedback-policy.js';
import { loadPrefs, setPref } from './prefs.js';
import { isSupported as speechSupported } from './speech.js';

let audioContext = null;

function capabilities() {
  return {
    vibrate: typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function',
    speech: speechSupported(),
    audio: typeof window !== 'undefined' && typeof (window.AudioContext || window.webkitAudioContext) === 'function',
  };
}

export function feedbackPrefs() {
  return mergeFeedbackPrefs(loadPrefs());
}

export function setFeedbackPref(key, value) {
  if (!['voiceEnabled', 'effectsEnabled', 'hapticsEnabled', 'quietMode'].includes(key) || typeof value !== 'boolean') return false;
  setPref(key, value);
  return true;
}

function tone(correct) {
  try {
    const Context = window.AudioContext || window.webkitAudioContext;
    audioContext = audioContext || new Context();
    const now = audioContext.currentTime;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(correct ? 880 : 220, now);
    if (correct) osc.frequency.setValueAtTime(1320, now + 0.08);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc.connect(gain).connect(audioContext.destination);
    osc.start(now);
    osc.stop(now + 0.24);
  } catch { /* 音效失敗不影響作答 */ }
}

/**
 * 答題後的音效與震動；判題結果已經決定，這裡只是附加回饋。
 */
export function answerFeedback(correct) {
  const decision = resolveFeedback({ prefs: feedbackPrefs(), capabilities: capabilities(),
    purpose: correct ? 'answer-correct' : 'answer-wrong' });
  if (decision.sound) tone(correct);
  if (decision.haptic) {
    try { navigator.vibrate(correct ? 30 : [40, 60, 40]); } catch { /* 不支援就略過 */ }
  }
  return decision;
}

/**
 * 聽力題播放許可：安靜模式時回傳 needsUserChoice，由畫面請使用者選擇播放或跳過。
 */
export function listeningDecision({ userInitiated = false } = {}) {
  return resolveFeedback({ prefs: feedbackPrefs(), capabilities: capabilities(), purpose: 'listening-prompt', userInitiated });
}
