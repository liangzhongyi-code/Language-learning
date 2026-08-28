import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateWord,
  validateSentence,
  validateKana,
  validateLetter,
  validateScene,
  validateReading,
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

test('validateWord：level 不在 1-5 被擋下', () => {
  assert.equal(validateWord({ ...EN_WORD, level: 0 }, 'en').ok, false);
  assert.equal(validateWord({ ...EN_WORD, level: 6 }, 'en').ok, false);
  assert.equal(validateWord({ ...EN_WORD, level: '1' }, 'en').ok, false);
});

test('validateWord：level 4 與 5 是合法值（多益 800+ 與日檢 N2/N1）', () => {
  assert.equal(validateWord({ ...EN_WORD, level: 4 }, 'en').ok, true);
  assert.equal(validateWord({ ...EN_WORD, level: 5 }, 'en').ok, true);
});

test('validateWord：id 格式不符被擋下', () => {
  assert.equal(validateWord({ ...EN_WORD, id: 'en-w-1' }, 'en').ok, false);
  assert.equal(validateWord({ ...EN_WORD, id: 'ja-w-001' }, 'en').ok, false);
});

/**
 * 原本的 id 流水號寫死三位，題庫一過 999 筆就全部驗不過。
 * 匯入多益與日檢題庫後單筆語言會到四位數，這裡把邊界釘住。
 */
test('validateWord：id 流水號可以是 3 到 5 位，超出範圍被擋下', () => {
  for (const id of ['en-w-001', 'en-w-0850', 'en-w-12000']) {
    assert.equal(validateWord({ ...EN_WORD, id }, 'en').ok, true, `${id} 應合法`);
  }
  for (const id of ['en-w-12', 'en-w-123456']) {
    assert.equal(validateWord({ ...EN_WORD, id }, 'en').ok, false, `${id} 應被擋下`);
  }
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

/**
 * 情境題與閱讀題的驗證。
 *
 * 這兩個驗證器是題庫的守門員，但它們自己也要被測——
 * 只拿現有的合法資料跑，走的永遠是「通過」那條路，
 * 拒絕分支有沒有真的攔得住人不會有人知道。
 */
const SCENE = {
  id: 'ja-sc-001',
  axis: 'self',
  scene: '公司的正式會議上，你要向社長報告。',
  ask: '這時候該怎麼自稱？',
  answer: 'わたくし',
  reading: 'わたくし',
  options: ['わたくし', 'おれ', 'ぼく', 'うち'],
  note: '最正式的自稱，商務場合對上位者用。',
  category: 'business',
  level: 4,
};

const READING = {
  id: 'ja-r-001',
  title: '田中さんの一日',
  passage: 'あ'.repeat(150),
  translation: '中文翻譯',
  category: 'daily',
  level: 2,
  questions: [
    {
      id: 'ja-r-001-q1',
      ask: { zh: '中文問題', target: '日本語の質問' },
      options: [
        { zh: '甲', target: 'こう', correct: true },
        { zh: '乙', target: 'おつ' },
        { zh: '丙', target: 'へい' },
        { zh: '丁', target: 'てい' },
      ],
      note: '說明',
    },
    { ...{}, id: 'ja-r-001-q2', ask: { zh: '問題二', target: '質問二' },
      options: [
        { zh: '一', target: 'いち', correct: true },
        { zh: '二', target: 'に' },
        { zh: '三', target: 'さん' },
        { zh: '四', target: 'よん' },
      ], note: '說明' },
    { id: 'ja-r-001-q3', ask: { zh: '問題三', target: '質問三' },
      options: [
        { zh: 'A', target: 'エー', correct: true },
        { zh: 'B', target: 'ビー' },
        { zh: 'C', target: 'シー' },
        { zh: 'D', target: 'ディー' },
      ], note: '說明' },
  ],
};

test('validateScene：合法的情境題通過', () => {
  assert.equal(validateScene(SCENE, 'ja').ok, true);
});

test('validateScene：answer 不在 options 裡會被擋下——那題無解', () => {
  const r = validateScene({ ...SCENE, answer: 'わし' }, 'ja');
  assert.equal(r.ok, false);
  assert.ok(fieldsOf(r).includes('options'));
  assert.ok(r.errors.some((e) => e.message.includes('無解')));
});

test('validateScene：選項多一個也被擋下（鍵盤只到 4）', () => {
  const r = validateScene({ ...SCENE, options: [...SCENE.options, 'わし'] }, 'ja');
  assert.equal(r.ok, false);
  assert.ok(fieldsOf(r).includes('options'));
});

test('validateScene：選項少一個也被擋下', () => {
  const r = validateScene({ ...SCENE, options: SCENE.options.slice(0, 3) }, 'ja');
  assert.equal(r.ok, false);
  assert.ok(fieldsOf(r).includes('options'));
});

test('validateScene：重複的選項會被擋下', () => {
  const r = validateScene({ ...SCENE, options: ['わたくし', 'おれ', 'おれ', 'うち'] }, 'ja');
  assert.equal(r.ok, false);
  assert.ok(fieldsOf(r).includes('options'));
});

test('validateScene：未定義的考點軸會被擋下', () => {
  const r = validateScene({ ...SCENE, axis: 'nonsense' }, 'ja');
  assert.equal(r.ok, false);
  assert.ok(fieldsOf(r).includes('axis'));
});

test('validateScene：缺 note 會被擋下——沒有解釋就只是背答案', () => {
  const r = validateScene({ ...SCENE, note: '' }, 'ja');
  assert.equal(r.ok, false);
  assert.ok(fieldsOf(r).includes('note'));
});

test('validateReading：合法的短文通過', () => {
  assert.equal(validateReading(READING, 'ja').ok, true);
});

test('validateReading：短文太短會被擋下', () => {
  const r = validateReading({ ...READING, passage: 'あ'.repeat(80) }, 'ja');
  assert.equal(r.ok, false);
  assert.ok(fieldsOf(r).includes('passage'));
});

test('validateReading：英文短文用詞數計量', () => {
  const en = {
    ...READING,
    id: 'en-r-001',
    passage: 'word '.repeat(60).trim(),
    questions: READING.questions.map((q, i) => ({ ...q, id: `en-r-001-q${i + 1}` })),
  };
  assert.equal(validateReading(en, 'en').ok, true);
  const short = { ...en, passage: 'word '.repeat(30).trim() };
  assert.equal(validateReading(short, 'en').ok, false);
});

test('validateReading：題數不足三題會被擋下', () => {
  const r = validateReading({ ...READING, questions: READING.questions.slice(0, 2) }, 'ja');
  assert.equal(r.ok, false);
  assert.ok(fieldsOf(r).includes('questions'));
});

test('validateReading：題目 id 不是「短文 id + -qN」會被擋下', () => {
  const bad = { ...READING, questions: [{ ...READING.questions[0], id: 'ja-r-001-x1' }, ...READING.questions.slice(1)] };
  const r = validateReading(bad, 'ja');
  assert.equal(r.ok, false);
  assert.ok(fieldsOf(r).some((f) => f.includes('id')));
});

test('validateReading：沒有正解會被擋下', () => {
  const q = { ...READING.questions[0], options: READING.questions[0].options.map((o) => ({ zh: o.zh, target: o.target })) };
  const r = validateReading({ ...READING, questions: [q, ...READING.questions.slice(1)] }, 'ja');
  assert.equal(r.ok, false);
  assert.ok(fieldsOf(r).some((f) => f.includes('options')));
});

test('validateReading：兩個正解會被擋下——那題會變成雙正解', () => {
  const opts = READING.questions[0].options.map((o, i) => (i <= 1 ? { ...o, correct: true } : o));
  const q = { ...READING.questions[0], options: opts };
  const r = validateReading({ ...READING, questions: [q, ...READING.questions.slice(1)] }, 'ja');
  assert.equal(r.ok, false);
  assert.ok(fieldsOf(r).some((f) => f.includes('options')));
});

test('validateReading：缺 target 版的問法會被擋下——語言開關會出現空白', () => {
  const q = { ...READING.questions[0], ask: { zh: '中文問題' } };
  const r = validateReading({ ...READING, questions: [q, ...READING.questions.slice(1)] }, 'ja');
  assert.equal(r.ok, false);
  assert.ok(fieldsOf(r).some((f) => f.includes('ask')));
});

test('validateReading：同一語言的選項重複會被擋下', () => {
  const opts = [...READING.questions[0].options];
  opts[1] = { ...opts[1], zh: opts[0].zh };
  const q = { ...READING.questions[0], options: opts };
  const r = validateReading({ ...READING, questions: [q, ...READING.questions.slice(1)] }, 'ja');
  assert.equal(r.ok, false);
  assert.ok(fieldsOf(r).some((f) => f.includes('options')));
});
