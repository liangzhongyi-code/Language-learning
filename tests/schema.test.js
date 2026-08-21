import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateWord,
  validateSentence,
  validateKana,
  validateLetter,
  validateDataset,
  findDuplicateIds,
} from '../assets/js/core/schema.js';

/**
 * 一筆合法的英文單字，各測試以展開的方式局部覆寫欄位來製造錯誤
 */
const EN_WORD = {
  id: 'en-w-001',
  zh: '羽毛球',
  target: 'badminton',
  reading: null,
  romaji: null,
  pos: 'noun',
  category: 'sport',
  level: 1,
};

/**
 * 一筆合法的日文單字
 */
const JA_WORD = {
  id: 'ja-w-001',
  zh: '雨',
  target: '雨',
  reading: 'あめ',
  romaji: 'ame',
  pos: 'noun',
  category: 'weather',
  level: 1,
};

/**
 * 取出錯誤中提到的欄位名，方便斷言
 */
const fieldsOf = (result) => result.errors.map((e) => e.field);

test('validateWord：合法的英文單字通過', () => {
  const r = validateWord(EN_WORD, 'en');
  assert.equal(r.ok, true, `不該有錯誤，實際：${JSON.stringify(r.errors)}`);
  assert.deepEqual(r.errors, []);
});

test('validateWord：合法的日文單字通過', () => {
  const r = validateWord(JA_WORD, 'ja');
  assert.equal(r.ok, true, `不該有錯誤，實際：${JSON.stringify(r.errors)}`);
});

test('validateWord：日文單字缺 reading 被擋下', () => {
  const r = validateWord({ ...JA_WORD, reading: null }, 'ja');
  assert.equal(r.ok, false);
  assert.ok(fieldsOf(r).includes('reading'), '錯誤必須指出 reading 欄位');
});

test('validateWord：日文單字 reading 為空字串也被擋下', () => {
  const r = validateWord({ ...JA_WORD, reading: '' }, 'ja');
  assert.equal(r.ok, false);
  assert.ok(fieldsOf(r).includes('reading'));
});

test('validateWord：日文單字缺 romaji 被擋下', () => {
  const r = validateWord({ ...JA_WORD, romaji: '' }, 'ja');
  assert.equal(r.ok, false);
  assert.ok(fieldsOf(r).includes('romaji'));
});

test('validateWord：英文單字帶了 reading 內容被擋下', () => {
  const r = validateWord({ ...EN_WORD, reading: 'badminton' }, 'en');
  assert.equal(r.ok, false);
  assert.ok(fieldsOf(r).includes('reading'), '英文的 reading 必須是 null');
});

test('validateWord：缺 zh 被擋下', () => {
  const r = validateWord({ ...EN_WORD, zh: '' }, 'en');
  assert.equal(r.ok, false);
  assert.ok(fieldsOf(r).includes('zh'));
});

test('validateWord：缺 target 被擋下', () => {
  const r = validateWord({ ...EN_WORD, target: '   ' }, 'en');
  assert.equal(r.ok, false);
  assert.ok(fieldsOf(r).includes('target'));
});

test('validateWord：pos 不在列舉內被擋下', () => {
  const r = validateWord({ ...EN_WORD, pos: 'pronoun' }, 'en');
  assert.equal(r.ok, false);
  const e = r.errors.find((x) => x.field === 'pos');
  assert.ok(e, '錯誤必須指出 pos 欄位');
  assert.ok(e.message.includes('pronoun'), '訊息要帶出實際的錯誤值');
});

test('validateWord：category 不在列舉內被擋下', () => {
  const r = validateWord({ ...EN_WORD, category: 'spaceship' }, 'en');
  assert.equal(r.ok, false);
  assert.ok(fieldsOf(r).includes('category'));
});

test('validateWord：level 不在 1-3 被擋下', () => {
  assert.equal(validateWord({ ...EN_WORD, level: 0 }, 'en').ok, false);
  assert.equal(validateWord({ ...EN_WORD, level: 4 }, 'en').ok, false);
  assert.equal(validateWord({ ...EN_WORD, level: '1' }, 'en').ok, false);
});

test('validateWord：id 格式不符被擋下', () => {
  assert.equal(validateWord({ ...EN_WORD, id: 'en-w-1' }, 'en').ok, false);
  assert.equal(validateWord({ ...EN_WORD, id: 'ja-w-001' }, 'en').ok, false);
});

test('validateWord：錯誤回報帶有該筆的 id', () => {
  const r = validateWord({ ...EN_WORD, pos: 'nope' }, 'en');
  assert.equal(r.errors[0].id, 'en-w-001');
});

test('validateWord：一次回報所有錯誤而非只回第一個', () => {
  const r = validateWord({ ...EN_WORD, zh: '', pos: 'nope', level: 9 }, 'en');
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 3, `應有 3 個錯誤，實際：${JSON.stringify(r.errors)}`);
});

/* ──────────────────────────────────────────────────────────────
   validateSentence
   ────────────────────────────────────────────────────────────── */

/**
 * 英文句：時間區塊在中文是第 2 塊、在英文跑到句尾
 */
const EN_SENT = {
  id: 'en-s-001',
  zh: '我今天去打羽毛球',
  target: 'I play badminton today',
  reading: null,
  patternId: 'en-p-svo-time',
  chunks: [
    { role: 'subject', zh: '我', target: 'I', zhIndex: 0 },
    { role: 'verb', zh: '去打', target: 'play', zhIndex: 2 },
    { role: 'object', zh: '羽毛球', target: 'badminton', zhIndex: 3 },
    { role: 'time', zh: '今天', target: 'today', zhIndex: 1 },
  ],
  note: '英文的時間副詞多半放句尾，中文放在主詞後面。',
  category: 'sport',
  level: 1,
};

/**
 * 日文句：助詞獨立成塊、zh 為空字串且取尾端的 zhIndex，動詞墊底
 */
const JA_SENT = {
  id: 'ja-s-001',
  zh: '我今天去打羽毛球',
  target: '私は今日バドミントンをします',
  reading: 'わたしはきょうバドミントンをします',
  patternId: 'ja-p-sotv',
  chunks: [
    { role: 'subject', zh: '我', target: '私', zhIndex: 0 },
    { role: 'particle', zh: '', target: 'は', zhIndex: 4 },
    { role: 'time', zh: '今天', target: '今日', zhIndex: 1 },
    { role: 'object', zh: '羽毛球', target: 'バドミントン', zhIndex: 3 },
    { role: 'particle', zh: '', target: 'を', zhIndex: 5 },
    { role: 'verb', zh: '去打', target: 'します', zhIndex: 2 },
  ],
  note: '日文動詞永遠放句尾，助詞「は」標示主題、「を」標示受詞。',
  category: 'sport',
  level: 1,
};

/**
 * 覆寫某一個 chunk 的欄位，其餘保持不變
 */
const withChunk = (sent, i, patch) => ({
  ...sent,
  chunks: sent.chunks.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
});

test('validateSentence：合法的英文句通過', () => {
  const r = validateSentence(EN_SENT, 'en');
  assert.equal(r.ok, true, `不該有錯誤，實際：${JSON.stringify(r.errors)}`);
});

test('validateSentence：合法的日文句通過（助詞 zh 為空、取尾端 zhIndex）', () => {
  const r = validateSentence(JA_SENT, 'ja');
  assert.equal(r.ok, true, `不該有錯誤，實際：${JSON.stringify(r.errors)}`);
});

test('validateSentence：target 串接對不回原句被擋下', () => {
  const r = validateSentence(withChunk(EN_SENT, 1, { target: 'eat' }), 'en');
  assert.equal(r.ok, false);
  assert.ok(fieldsOf(r).includes('chunks.target'), '錯誤必須指出 target 串接不一致');
});

test('validateSentence：target 串接比對忽略空白差異', () => {
  const spaced = { ...EN_SENT, target: '  I   play badminton today ' };
  assert.equal(validateSentence(spaced, 'en').ok, true, '只有空白不同不該被判定為錯誤');
});

test('validateSentence：日文 target 串接不加空白', () => {
  const r = validateSentence(JA_SENT, 'ja');
  assert.equal(r.ok, true);
  const joined = JA_SENT.chunks.map((c) => c.target).join('');
  assert.equal(joined, JA_SENT.target);
});

test('validateSentence：zh 串接對不回原句被擋下', () => {
  const r = validateSentence(withChunk(EN_SENT, 3, { zh: '明天' }), 'en');
  assert.equal(r.ok, false);
  assert.ok(fieldsOf(r).includes('chunks.zh'));
});

test('validateSentence：zhIndex 跳號被擋下', () => {
  const broken = withChunk(EN_SENT, 2, { zhIndex: 5 });
  const r = validateSentence(broken, 'en');
  assert.equal(r.ok, false);
  const e = r.errors.find((x) => x.field === 'chunks.zhIndex');
  assert.ok(e, '錯誤必須指出 zhIndex');
  assert.ok(/連續/.test(e.message), '訊息要說明是連續性問題');
});

test('validateSentence：zhIndex 重複被擋下', () => {
  const r = validateSentence(withChunk(EN_SENT, 3, { zhIndex: 0 }), 'en');
  assert.equal(r.ok, false);
  assert.ok(fieldsOf(r).includes('chunks.zhIndex'));
});

test('validateSentence：zhIndex 不是從 0 起算被擋下', () => {
  const shifted = {
    ...EN_SENT,
    chunks: EN_SENT.chunks.map((c) => ({ ...c, zhIndex: c.zhIndex + 1 })),
  };
  assert.equal(validateSentence(shifted, 'en').ok, false);
});

test('validateSentence：未知的 role 被擋下並指出實際值', () => {
  const r = validateSentence(withChunk(EN_SENT, 0, { role: 'foobar' }), 'en');
  assert.equal(r.ok, false);
  const e = r.errors.find((x) => x.field === 'chunks.role');
  assert.ok(e);
  assert.ok(e.message.includes('foobar'));
});

test('validateSentence：chunks 的 role 順序必須與句型定義一致', () => {
  const swapped = {
    ...EN_SENT,
    chunks: [EN_SENT.chunks[1], EN_SENT.chunks[0], EN_SENT.chunks[2], EN_SENT.chunks[3]],
  };
  const r = validateSentence(swapped, 'en');
  assert.equal(r.ok, false);
  assert.ok(fieldsOf(r).includes('patternId'));
});

test('validateSentence：未知的 patternId 被擋下', () => {
  const r = validateSentence({ ...EN_SENT, patternId: 'en-p-nope' }, 'en');
  assert.equal(r.ok, false);
  assert.ok(fieldsOf(r).includes('patternId'));
});

test('validateSentence：patternId 的語言不符被擋下', () => {
  const r = validateSentence({ ...EN_SENT, patternId: 'ja-p-sov' }, 'en');
  assert.equal(r.ok, false);
  assert.ok(fieldsOf(r).includes('patternId'));
});

test('validateSentence：note 為空被擋下', () => {
  assert.equal(validateSentence({ ...EN_SENT, note: '' }, 'en').ok, false);
  assert.equal(validateSentence({ ...EN_SENT, note: '   ' }, 'en').ok, false);
});

test('validateSentence：日文缺整句 reading 被擋下', () => {
  const r = validateSentence({ ...JA_SENT, reading: '' }, 'ja');
  assert.equal(r.ok, false);
  assert.ok(fieldsOf(r).includes('reading'));
});

test('validateSentence：英文的 reading 必須是 null', () => {
  const r = validateSentence({ ...EN_SENT, reading: 'ai plei' }, 'en');
  assert.equal(r.ok, false);
  assert.ok(fieldsOf(r).includes('reading'));
});

test('validateSentence：chunk 的 target 為空被擋下', () => {
  const r = validateSentence(withChunk(EN_SENT, 0, { target: '' }), 'en');
  assert.equal(r.ok, false);
  assert.ok(fieldsOf(r).includes('chunks.target'));
});

test('validateSentence：chunks 不是陣列或為空被擋下', () => {
  assert.equal(validateSentence({ ...EN_SENT, chunks: [] }, 'en').ok, false);
  assert.equal(validateSentence({ ...EN_SENT, chunks: null }, 'en').ok, false);
});

test('validateSentence：id 格式不符被擋下', () => {
  assert.equal(validateSentence({ ...EN_SENT, id: 'en-s-1' }, 'en').ok, false);
  assert.equal(validateSentence({ ...EN_SENT, id: 'en-w-001' }, 'en').ok, false);
});

test('validateSentence：一次回報多個錯誤', () => {
  const bad = { ...EN_SENT, note: '', category: 'nope', level: 7 };
  const r = validateSentence(bad, 'en');
  assert.equal(r.errors.length, 3, `實際：${JSON.stringify(r.errors)}`);
});

/* ──────────────────────────────────────────────────────────────
   validateKana / validateLetter
   ────────────────────────────────────────────────────────────── */

const SEION = {
  id: 'ja-k-a',
  hiragana: 'あ',
  katakana: 'ア',
  romaji: 'a',
  type: 'seion',
  row: 'あ',
  column: 'a',
  seionSource: null,
  exampleWord: 'あめ',
  exampleZh: '雨',
};

const DAKUON = {
  id: 'ja-k-ga',
  hiragana: 'が',
  katakana: 'ガ',
  romaji: 'ga',
  type: 'dakuon',
  row: 'が',
  column: 'a',
  seionSource: 'か',
  exampleWord: 'がっこう',
  exampleZh: '學校',
};

const YOUON = {
  id: 'ja-k-kya',
  hiragana: 'きゃ',
  katakana: 'キャ',
  romaji: 'kya',
  type: 'youon',
  row: 'き',
  column: 'ya',
  seionSource: null,
  exampleWord: 'きゃく',
  exampleZh: '客人',
};

test('validateKana：合法的清音、濁音、拗音都通過', () => {
  for (const k of [SEION, DAKUON, YOUON]) {
    const r = validateKana(k);
    assert.equal(r.ok, true, `${k.id} 不該有錯誤，實際：${JSON.stringify(r.errors)}`);
  }
});

test('validateKana：id 必須等於 ja-k- 加上 romaji', () => {
  const r = validateKana({ ...SEION, id: 'ja-k-aa' });
  assert.equal(r.ok, false);
  assert.ok(fieldsOf(r).includes('id'));
});

test('validateKana：type 不在列舉內被擋下', () => {
  const r = validateKana({ ...SEION, type: 'sokuon' });
  assert.equal(r.ok, false);
  const e = r.errors.find((x) => x.field === 'type');
  assert.ok(e.message.includes('sokuon'));
});

test('validateKana：拗音必須是兩個字元', () => {
  const r = validateKana({ ...YOUON, hiragana: 'き', katakana: 'キ' });
  assert.equal(r.ok, false);
  assert.ok(fieldsOf(r).includes('hiragana'));
});

test('validateKana：拗音第二個字必須是小字 ゃゅょ', () => {
  const r = validateKana({ ...YOUON, hiragana: 'きや' });
  assert.equal(r.ok, false);
  assert.ok(fieldsOf(r).includes('hiragana'));
});

test('validateKana：拗音的 column 限 ya/yu/yo', () => {
  assert.equal(validateKana({ ...YOUON, column: 'a' }).ok, false);
  assert.equal(validateKana({ ...YOUON, column: 'yu' }).ok, false, 'yu 段的假名應為 きゅ，與 column 不符時要擋');
});

test('validateKana：清音的 column 限 a/i/u/e/o', () => {
  assert.equal(validateKana({ ...SEION, column: 'ya' }).ok, false);
});

test('validateKana：濁音必須有清音來源', () => {
  const r = validateKana({ ...DAKUON, seionSource: null });
  assert.equal(r.ok, false);
  assert.ok(fieldsOf(r).includes('seionSource'));
});

test('validateKana：清音不可有清音來源', () => {
  const r = validateKana({ ...SEION, seionSource: 'あ' });
  assert.equal(r.ok, false);
  assert.ok(fieldsOf(r).includes('seionSource'));
});

test('validateKana：缺例字或例字中文被擋下', () => {
  assert.equal(validateKana({ ...SEION, exampleWord: '' }).ok, false);
  assert.equal(validateKana({ ...SEION, exampleZh: '  ' }).ok, false);
});

test('validateLetter：合法字母通過', () => {
  const r = validateLetter({
    id: 'en-a-a',
    upper: 'A',
    lower: 'a',
    ipa: '/eɪ/',
    exampleWord: 'apple',
    exampleZh: '蘋果',
  });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('validateLetter：例字必須以該字母開頭', () => {
  const r = validateLetter({
    id: 'en-a-a',
    upper: 'A',
    lower: 'a',
    ipa: '/eɪ/',
    exampleWord: 'banana',
    exampleZh: '香蕉',
  });
  assert.equal(r.ok, false);
  assert.ok(fieldsOf(r).includes('exampleWord'));
});

test('validateLetter：缺 IPA 被擋下', () => {
  const r = validateLetter({
    id: 'en-a-b',
    upper: 'B',
    lower: 'b',
    ipa: '',
    exampleWord: 'ball',
    exampleZh: '球',
  });
  assert.equal(r.ok, false);
  assert.ok(fieldsOf(r).includes('ipa'));
});

/* ──────────────────────────────────────────────────────────────
   findDuplicateIds / validateDataset
   ────────────────────────────────────────────────────────────── */

test('findDuplicateIds：偵測出重複的 id', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'a' }, { id: 'c' }, { id: 'b' }];
  const dups = findDuplicateIds(list);
  assert.deepEqual([...dups].sort(), ['a', 'b']);
});

test('findDuplicateIds：沒有重複時回傳空陣列', () => {
  assert.deepEqual(findDuplicateIds([{ id: 'a' }, { id: 'b' }]), []);
});

test('findDuplicateIds：同一個 id 出現三次仍只回報一次', () => {
  assert.deepEqual(findDuplicateIds([{ id: 'x' }, { id: 'x' }, { id: 'x' }]), ['x']);
});

test('validateDataset：全部合法時回傳空陣列', () => {
  const errors = validateDataset({ words: [EN_WORD], sentences: [EN_SENT] }, 'en');
  assert.deepEqual(errors, [], JSON.stringify(errors));
});

test('validateDataset：三筆不同錯誤全部回報，不會遇到第一個就中止', () => {
  const errors = validateDataset(
    {
      words: [
        { ...EN_WORD, id: 'en-w-001', pos: 'nope' },
        { ...EN_WORD, id: 'en-w-002', category: 'nope' },
      ],
      sentences: [{ ...EN_SENT, note: '' }],
    },
    'en'
  );
  assert.equal(errors.length, 3, `實際：${JSON.stringify(errors)}`);
  assert.ok(errors.every((e) => e.id && e.field), '每個錯誤都要帶 id 與 field');
});

test('validateDataset：重複的 id 也會被回報', () => {
  const errors = validateDataset(
    { words: [EN_WORD, { ...EN_WORD }], sentences: [EN_SENT] },
    'en'
  );
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, 'id');
  assert.ok(errors[0].message.includes('en-w-001'));
});

test('validateDataset：缺少的區塊視為空而非報錯', () => {
  assert.deepEqual(validateDataset({ words: [EN_WORD] }, 'en'), []);
  assert.deepEqual(validateDataset({}, 'en'), []);
});

test('validateDataset：日文的假名區塊也會被驗到', () => {
  const errors = validateDataset({ kana: [{ ...SEION, exampleWord: '' }] }, 'ja');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, 'exampleWord');
});
