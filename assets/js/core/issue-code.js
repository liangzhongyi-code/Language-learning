/**
 * 題目問題回報代碼。
 *
 * 這份代碼只帶目前題目的定位資訊、畫面快照、當局設定與使用者輸入的說明；
 * 不讀 localStorage，也不包含答題統計或其他題目的學習紀錄。
 */

const PREFIX = 'langissue1:';
const MAX_DESCRIPTION = 300;

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(text) {
  const standard = text.replace(/-/g, '+').replace(/_/g, '/');
  if (standard.length % 4 === 1) throw new Error('回報代碼不完整，可能少複製了一段。');
  const padded = standard.padEnd(Math.ceil(standard.length / 4) * 4, '=');
  let binary;
  try {
    binary = atob(padded);
  } catch {
    throw new Error('回報代碼不完整或被改動過。');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(binary, (char) => char.charCodeAt(0))
    );
  } catch {
    throw new Error('回報代碼不完整或被改動過。');
  }
}

/**
 * FNV-1a 校驗碼。它不是加密，只用來抓出通訊軟體截斷或手動複製時的單字元損壞。
 */
function checksumOf(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function chosenAnswer(question) {
  if (question.kind === 'cloze') {
    return question.submitted ? [...question.filled] : null;
  }
  return Number.isInteger(question.answeredIndex)
    ? question.options?.[question.answeredIndex]?.text ?? null
    : null;
}

function correctAnswer(question) {
  if (question.kind === 'cloze') return (question.blanks || []).map((blank) => blank.answer);
  return question.options?.[question.correctIndex]?.text ?? null;
}

/**
 * 產生可定位題目的回報內容。
 */
export function issueReportOf({ session, question, index, settings = {}, description = '', now = Date.now() }) {
  if (!session || !question?.sourceId) throw new Error('目前沒有可以回報的題目。');

  const options = question.kind === 'cloze'
    ? (question.bank || []).map((text, i) => ({ text, ruby: question.bankRuby?.[i] ?? null }))
    : (question.options || []).map((option) => ({ text: option.text, ruby: option.ruby ?? null }));

  return {
    version: 1,
    createdAt: now,
    lang: session.lang,
    source: session.source,
    sessionLevel: session.level ?? null,
    question: {
      number: Number(index) + 1,
      sourceId: question.sourceId,
      passageId: question.passageId ?? null,
      level: question.level ?? null,
      kind: question.kind,
      direction: question.direction ?? null,
      title: question.title ?? null,
      context: question.context ?? null,
      translation: question.translation ?? null,
      prompt: question.prompt ?? null,
      promptRuby: question.promptRuby ?? null,
      promptLang: question.promptLang ?? null,
      optionLang: question.optionLang ?? null,
      segments: question.segments ?? null,
      gap: question.gap ?? null,
      options,
      correct: correctAnswer(question),
      chosen: chosenAnswer(question),
    },
    settings: {
      direction: question.direction ?? settings.direction ?? session.direction ?? null,
      kanjiMode: settings.kanjiMode ?? null,
      readingAskIn: settings.readingAskIn ?? null,
      scope: settings.scope ?? null,
      questionCount: session.questions?.length ?? null,
    },
    description: String(description ?? '').trim().slice(0, MAX_DESCRIPTION),
  };
}

/**
 * 把回報內容轉成適合貼進聊天訊息的單行代碼。
 */
export function encodeIssueCode(report) {
  if (!report || report.version !== 1 || !report.question?.sourceId) {
    throw new Error('回報內容格式不正確。');
  }
  const body = toBase64Url(JSON.stringify(report));
  return `${PREFIX}${body}.${checksumOf(body)}`;
}

/**
 * 讀取單獨貼上的代碼，也接受前後夾著一般聊天文字。
 */
export function decodeIssueCode(text) {
  const cleaned = String(text ?? '')
    .replace(/[\s\u200B-\u200D\u00AD\uFEFF]+/g, '')
    .replace(/\uFF1A/g, ':');
  const match = cleaned.match(/langissue1:([A-Za-z0-9_-]+)\.([0-9a-fA-F]{8})/);
  if (!match) {
    if (cleaned.includes(PREFIX)) throw new Error('回報代碼不完整，可能少複製了一段。');
    throw new Error('這不是本站的題目回報代碼。');
  }
  if (checksumOf(match[1]) !== match[2].toLowerCase()) {
    throw new Error('回報代碼不完整或被改動過。');
  }

  let parsed;
  try {
    parsed = JSON.parse(fromBase64Url(match[1]));
  } catch (error) {
    if (/回報代碼/.test(error.message)) throw error;
    throw new Error('回報代碼不完整或被改動過。');
  }
  if (parsed?.version !== 1 || typeof parsed?.question?.sourceId !== 'string') {
    throw new Error('這個回報代碼的內容格式不正確。');
  }
  return parsed;
}
