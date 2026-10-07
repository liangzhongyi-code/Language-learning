/**
 * 日文新題型的人工核對種子資料（目前只有 N5，即題庫 level 1）。
 *
 * 每一筆都引用既有題庫的真實 id：單字題引用 words.js，排句引用 sentences.js。
 * 朗讀與拼字的外文正解一律用假名讀音，與既有題庫「朗讀文字用假名」的慣例一致。
 * 題型與欄位：
 *   typing    看中文打日文；accepted 同時收假名讀音與標準漢字寫法（片假名輸入會先轉成平假名再比）。
 *             中文提示與日文漢字寫法完全相同的字（水、山、魚）不收，否則照抄提示就能答對。
 *   kana      看漢字詞打假名讀音；accepted 只放平假名讀音。
 *   listening 聽日文選中文；options 四個中文選項、correctIndex 指正解。
 *             有同級同音字（橋／箸、雨／飴）時附 context 朗讀句，且同音字的意思不可當干擾選項。
 *   dictation 聽日文打日文；accepted 收假名讀音與漢字寫法。只收沒有同音字的詞。
 *   tiles     看中文拼假名；fragments 依正解順序列出，小假名（っ、ゃ、ゅ、ょ）是獨立片段。
 *   reorder   看中文排句子；chunks 取自來源句（助詞是獨立片段），legalOrders 列出所有合法語序。
 *             核對原則：述語固定在句尾、助詞緊跟在它的名詞後面；述語前的「名詞＋助詞」短語與
 *             時間詞彼此可以換位（日文語序的 scrambling），例如「コーヒーを私は飲みます」也合法。
 *   pos       語境詞性；position 是 targetWord 在 sentence 中的字元起點。
 *             元気（名詞／な形容詞）、まっすぐ（副詞／な形容詞）、色々（な形容詞／副詞）各有兩句。
 */

const POS = ['名詞', '動詞', 'い形容詞', 'な形容詞', '副詞'];

export const practice = [
  /* ── typing：看中文打日文 ── */
  { id: 'ja-x-001', mode: 'typing', sourceId: 'ja-w-015', level: 1, prompt: '貓', accepted: ['ねこ', '猫'], caseSensitive: false },
  { id: 'ja-x-002', mode: 'typing', sourceId: 'ja-w-014', level: 1, prompt: '狗', accepted: ['いぬ', '犬'], caseSensitive: false },
  { id: 'ja-x-003', mode: 'typing', sourceId: 'ja-w-002', level: 1, prompt: '蛋', accepted: ['たまご', '卵'], caseSensitive: false },
  { id: 'ja-x-004', mode: 'typing', sourceId: 'ja-w-065', level: 1, prompt: '學校', accepted: ['がっこう', '学校'], caseSensitive: false },
  { id: 'ja-x-005', mode: 'typing', sourceId: 'ja-w-066', level: 1, prompt: '車站', accepted: ['えき', '駅'], caseSensitive: false },
  { id: 'ja-x-006', mode: 'typing', sourceId: 'ja-w-067', level: 1, prompt: '醫院', accepted: ['びょういん', '病院'], caseSensitive: false },
  { id: 'ja-x-007', mode: 'typing', sourceId: 'ja-w-010', level: 1, prompt: '牛奶', accepted: ['ぎゅうにゅう', '牛乳'], caseSensitive: false },
  { id: 'ja-x-008', mode: 'typing', sourceId: 'ja-w-041', level: 1, prompt: '書', accepted: ['ほん', '本'], caseSensitive: false },
  { id: 'ja-x-009', mode: 'typing', sourceId: 'ja-w-483', level: 1, prompt: '時鐘', accepted: ['とけい', '時計'], caseSensitive: false },
  { id: 'ja-x-010', mode: 'typing', sourceId: 'ja-w-226', level: 1, prompt: '雨傘', accepted: ['かさ', '傘'], caseSensitive: false },
  /* 明日 另有あす的讀法，同樣正確 */
  { id: 'ja-x-011', mode: 'typing', sourceId: 'ja-w-073', level: 1, prompt: '明天', accepted: ['あした', 'あす', '明日'], caseSensitive: false },
  { id: 'ja-x-012', mode: 'typing', sourceId: 'ja-w-495', level: 1, prompt: '朋友', accepted: ['ともだち', '友達'], caseSensitive: false },

  /* ── kana：看漢字詞打假名讀音（刻意挑促音、拗音、濁音、半濁音） ── */
  { id: 'ja-x-013', mode: 'kana', sourceId: 'ja-w-065', level: 1, prompt: '学校', accepted: ['がっこう'] },
  { id: 'ja-x-014', mode: 'kana', sourceId: 'ja-w-067', level: 1, prompt: '病院', accepted: ['びょういん'] },
  { id: 'ja-x-015', mode: 'kana', sourceId: 'ja-w-010', level: 1, prompt: '牛乳', accepted: ['ぎゅうにゅう'] },
  { id: 'ja-x-016', mode: 'kana', sourceId: 'ja-w-027', level: 1, prompt: '電車', accepted: ['でんしゃ'] },
  { id: 'ja-x-017', mode: 'kana', sourceId: 'ja-w-029', level: 1, prompt: '自転車', accepted: ['じてんしゃ'] },
  { id: 'ja-x-018', mode: 'kana', sourceId: 'ja-w-071', level: 1, prompt: '図書館', accepted: ['としょかん'] },
  { id: 'ja-x-019', mode: 'kana', sourceId: 'ja-w-259', level: 1, prompt: '切手', accepted: ['きって'] },
  { id: 'ja-x-020', mode: 'kana', sourceId: 'ja-w-440', level: 1, prompt: '地図', accepted: ['ちず'] },
  { id: 'ja-x-021', mode: 'kana', sourceId: 'ja-w-166', level: 1, prompt: '鉛筆', accepted: ['えんぴつ'] },
  { id: 'ja-x-022', mode: 'kana', sourceId: 'ja-w-354', level: 1, prompt: '写真', accepted: ['しゃしん'] },
  { id: 'ja-x-023', mode: 'kana', sourceId: 'ja-w-260', level: 1, prompt: '切符', accepted: ['きっぷ'] },
  { id: 'ja-x-024', mode: 'kana', sourceId: 'ja-w-331', level: 1, prompt: '雑誌', accepted: ['ざっし'] },

  /* ── listening：聽日文選中文 ── */
  { id: 'ja-x-025', mode: 'listening', sourceId: 'ja-w-015', level: 1, prompt: '聽發音，選出中文意思', speakText: 'ねこ', options: ['貓', '狗', '鳥', '魚'], correctIndex: 0 },
  { id: 'ja-x-026', mode: 'listening', sourceId: 'ja-w-014', level: 1, prompt: '聽發音，選出中文意思', speakText: 'いぬ', options: ['貓', '狗', '鳥', '魚'], correctIndex: 1 },
  { id: 'ja-x-027', mode: 'listening', sourceId: 'ja-w-003', level: 1, prompt: '聽發音，選出中文意思', speakText: 'さかな', options: ['肉', '蛋', '魚', '水'], correctIndex: 2 },
  { id: 'ja-x-028', mode: 'listening', sourceId: 'ja-w-065', level: 1, prompt: '聽發音，選出中文意思', speakText: 'がっこう', options: ['醫院', '車站', '公園', '學校'], correctIndex: 3 },
  { id: 'ja-x-029', mode: 'listening', sourceId: 'ja-w-067', level: 1, prompt: '聽發音，選出中文意思', speakText: 'びょういん', options: ['醫院', '銀行', '圖書館', '學校'], correctIndex: 0 },
  { id: 'ja-x-030', mode: 'listening', sourceId: 'ja-w-071', level: 1, prompt: '聽發音，選出中文意思', speakText: 'としょかん', options: ['銀行', '圖書館', '醫院', '公園'], correctIndex: 1 },
  { id: 'ja-x-031', mode: 'listening', sourceId: 'ja-w-010', level: 1, prompt: '聽發音，選出中文意思', speakText: 'ぎゅうにゅう', options: ['茶', '咖啡', '牛奶', '水'], correctIndex: 2 },
  { id: 'ja-x-032', mode: 'listening', sourceId: 'ja-w-027', level: 1, prompt: '聽發音，選出中文意思', speakText: 'でんしゃ', options: ['公車', '腳踏車', '飛機', '電車'], correctIndex: 3 },
  { id: 'ja-x-033', mode: 'listening', sourceId: 'ja-w-029', level: 1, prompt: '聽發音，選出中文意思', speakText: 'じてんしゃ', options: ['腳踏車', '電車', '汽車', '船'], correctIndex: 0 },
  { id: 'ja-x-034', mode: 'listening', sourceId: 'ja-w-030', level: 1, prompt: '聽發音，選出中文意思', speakText: 'ひこうき', options: ['船', '飛機', '公車', '地下鐵'], correctIndex: 1 },
  { id: 'ja-x-035', mode: 'listening', sourceId: 'ja-w-354', level: 1, prompt: '聽發音，選出中文意思', speakText: 'しゃしん', options: ['報紙', '雜誌', '照片', '地圖'], correctIndex: 2 },
  { id: 'ja-x-036', mode: 'listening', sourceId: 'ja-w-483', level: 1, prompt: '聽發音，選出中文意思', speakText: 'とけい', options: ['鉛筆', '書', '椅子', '時鐘'], correctIndex: 3 },
  /* あめ 同音的「飴（糖果）」也是 N5：附「雨が降ります」的朗讀句，選項不放糖果 */
  { id: 'ja-x-037', mode: 'listening', sourceId: 'ja-w-050', level: 1, prompt: '聽發音，選出中文意思', speakText: 'あめ', context: 'あめがふります', options: ['雨', '雪', '風', '晴天'], correctIndex: 0 },
  /* はし 同音的「箸（筷子）」也是 N5：附「橋を渡ります」的朗讀句，選項不放筷子與末端 */
  { id: 'ja-x-038', mode: 'listening', sourceId: 'ja-w-543', level: 1, prompt: '聽發音，選出中文意思', speakText: 'はし', context: 'はしをわたります', options: ['道路', '橋', '河川', '車站'], correctIndex: 1 },

  /* ── dictation：聽日文打日文（只收沒有同音字的詞） ── */
  { id: 'ja-x-039', mode: 'dictation', sourceId: 'ja-w-065', level: 1, prompt: '聽發音，打出日文', speakText: 'がっこう', accepted: ['がっこう', '学校'] },
  { id: 'ja-x-040', mode: 'dictation', sourceId: 'ja-w-027', level: 1, prompt: '聽發音，打出日文', speakText: 'でんしゃ', accepted: ['でんしゃ', '電車'] },
  { id: 'ja-x-041', mode: 'dictation', sourceId: 'ja-w-071', level: 1, prompt: '聽發音，打出日文', speakText: 'としょかん', accepted: ['としょかん', '図書館'] },
  { id: 'ja-x-042', mode: 'dictation', sourceId: 'ja-w-010', level: 1, prompt: '聽發音，打出日文', speakText: 'ぎゅうにゅう', accepted: ['ぎゅうにゅう', '牛乳'] },
  { id: 'ja-x-043', mode: 'dictation', sourceId: 'ja-w-067', level: 1, prompt: '聽發音，打出日文', speakText: 'びょういん', accepted: ['びょういん', '病院'] },
  { id: 'ja-x-044', mode: 'dictation', sourceId: 'ja-w-354', level: 1, prompt: '聽發音，打出日文', speakText: 'しゃしん', accepted: ['しゃしん', '写真'] },
  { id: 'ja-x-045', mode: 'dictation', sourceId: 'ja-w-483', level: 1, prompt: '聽發音，打出日文', speakText: 'とけい', accepted: ['とけい', '時計'] },
  { id: 'ja-x-046', mode: 'dictation', sourceId: 'ja-w-029', level: 1, prompt: '聽發音，打出日文', speakText: 'じてんしゃ', accepted: ['じてんしゃ', '自転車'] },
  { id: 'ja-x-047', mode: 'dictation', sourceId: 'ja-w-030', level: 1, prompt: '聽發音，打出日文', speakText: 'ひこうき', accepted: ['ひこうき', '飛行機'] },
  { id: 'ja-x-048', mode: 'dictation', sourceId: 'ja-w-259', level: 1, prompt: '聽發音，打出日文', speakText: 'きって', accepted: ['きって', '切手'] },
  { id: 'ja-x-049', mode: 'dictation', sourceId: 'ja-w-166', level: 1, prompt: '聽發音，打出日文', speakText: 'えんぴつ', accepted: ['えんぴつ', '鉛筆'] },
  { id: 'ja-x-050', mode: 'dictation', sourceId: 'ja-w-331', level: 1, prompt: '聽發音，打出日文', speakText: 'ざっし', accepted: ['ざっし', '雑誌'] },

  /* ── tiles：看中文拼假名（小假名是獨立片段，可重複） ── */
  { id: 'ja-x-051', mode: 'tiles', sourceId: 'ja-w-065', level: 1, prompt: '學校', fragments: ['が', 'っ', 'こ', 'う'], answer: 'がっこう' },
  { id: 'ja-x-052', mode: 'tiles', sourceId: 'ja-w-027', level: 1, prompt: '電車', fragments: ['で', 'ん', 'し', 'ゃ'], answer: 'でんしゃ' },
  { id: 'ja-x-053', mode: 'tiles', sourceId: 'ja-w-354', level: 1, prompt: '照片', fragments: ['し', 'ゃ', 'し', 'ん'], answer: 'しゃしん' },
  { id: 'ja-x-054', mode: 'tiles', sourceId: 'ja-w-010', level: 1, prompt: '牛奶', fragments: ['ぎ', 'ゅ', 'う', 'に', 'ゅ', 'う'], answer: 'ぎゅうにゅう' },
  { id: 'ja-x-055', mode: 'tiles', sourceId: 'ja-w-395', level: 1, prompt: '老師', fragments: ['せ', 'ん', 'せ', 'い'], answer: 'せんせい' },
  { id: 'ja-x-056', mode: 'tiles', sourceId: 'ja-w-260', level: 1, prompt: '車票', fragments: ['き', 'っ', 'ぷ'], answer: 'きっぷ' },
  { id: 'ja-x-057', mode: 'tiles', sourceId: 'ja-w-067', level: 1, prompt: '醫院', fragments: ['び', 'ょ', 'う', 'い', 'ん'], answer: 'びょういん' },
  { id: 'ja-x-058', mode: 'tiles', sourceId: 'ja-w-029', level: 1, prompt: '腳踏車', fragments: ['じ', 'て', 'ん', 'し', 'ゃ'], answer: 'じてんしゃ' },
  { id: 'ja-x-059', mode: 'tiles', sourceId: 'ja-w-071', level: 1, prompt: '圖書館', fragments: ['と', 'し', 'ょ', 'か', 'ん'], answer: 'としょかん' },
  { id: 'ja-x-060', mode: 'tiles', sourceId: 'ja-w-259', level: 1, prompt: '郵票', fragments: ['き', 'っ', 'て'], answer: 'きって' },
  { id: 'ja-x-061', mode: 'tiles', sourceId: 'ja-w-015', level: 1, prompt: '貓', fragments: ['ね', 'こ'], answer: 'ねこ' },
  { id: 'ja-x-062', mode: 'tiles', sourceId: 'ja-w-440', level: 1, prompt: '地圖', fragments: ['ち', 'ず'], answer: 'ちず' },

  /* ── reorder：看中文排句子（chunks 取自 sentences.js 的來源句） ── */
  { id: 'ja-x-063', mode: 'reorder', sourceId: 'ja-s-001', level: 1, prompt: '我喝咖啡', chunks: ['私', 'は', 'コーヒー', 'を', '飲みます'], legalOrders: [[0, 1, 2, 3, 4], [2, 3, 0, 1, 4]] },
  { id: 'ja-x-064', mode: 'reorder', sourceId: 'ja-s-002', level: 1, prompt: '我看書', chunks: ['私', 'は', '本', 'を', '読みます'], legalOrders: [[0, 1, 2, 3, 4], [2, 3, 0, 1, 4]] },
  { id: 'ja-x-065', mode: 'reorder', sourceId: 'ja-s-003', level: 1, prompt: '我吃拉麵', chunks: ['私', 'は', 'ラーメン', 'を', '食べます'], legalOrders: [[0, 1, 2, 3, 4], [2, 3, 0, 1, 4]] },
  { id: 'ja-x-066', mode: 'reorder', sourceId: 'ja-s-004', level: 1, prompt: '貓吃魚', chunks: ['猫', 'は', '魚', 'を', '食べます'], legalOrders: [[0, 1, 2, 3, 4], [2, 3, 0, 1, 4]] },
  /* 「私は」「今日」「バドミントンを」三個短語在述語前任意換位，共 6 種 */
  { id: 'ja-x-067', mode: 'reorder', sourceId: 'ja-s-031', level: 1, prompt: '我今天去打羽毛球', chunks: ['私', 'は', '今日', 'バドミントン', 'を', 'します'],
    legalOrders: [[0, 1, 2, 3, 4, 5], [2, 0, 1, 3, 4, 5], [0, 1, 3, 4, 2, 5], [2, 3, 4, 0, 1, 5], [3, 4, 0, 1, 2, 5], [3, 4, 2, 0, 1, 5]] },
  { id: 'ja-x-068', mode: 'reorder', sourceId: 'ja-s-032', level: 1, prompt: '我寫信', chunks: ['私', 'は', '手紙', 'を', '書きます'], legalOrders: [[0, 1, 2, 3, 4], [2, 3, 0, 1, 4]] },
  { id: 'ja-x-069', mode: 'reorder', sourceId: 'ja-s-033', level: 1, prompt: '媽媽做菜', chunks: ['母', 'は', '料理', 'を', '作ります'], legalOrders: [[0, 1, 2, 3, 4], [2, 3, 0, 1, 4]] },
  /* 地點「公園で」可移到主題前：公園で子供は遊びます */
  { id: 'ja-x-070', mode: 'reorder', sourceId: 'ja-s-083', level: 1, prompt: '小孩在公園玩', chunks: ['子供', 'は', '公園', 'で', '遊びます'], legalOrders: [[0, 1, 2, 3, 4], [2, 3, 0, 1, 4]] },
  { id: 'ja-x-071', mode: 'reorder', sourceId: 'ja-s-098', level: 1, prompt: '這本書很有趣', chunks: ['この本', 'は', '面白いです'], legalOrders: [[0, 1, 2]] },
  { id: 'ja-x-072', mode: 'reorder', sourceId: 'ja-s-118', level: 1, prompt: '我的狗很小', chunks: ['私の犬', 'は', '小さいです'], legalOrders: [[0, 1, 2]] },
  { id: 'ja-x-073', mode: 'reorder', sourceId: 'ja-s-103', level: 1, prompt: '這個包包很重', chunks: ['このかばん', 'は', '重いです'], legalOrders: [[0, 1, 2]] },
  { id: 'ja-x-074', mode: 'reorder', sourceId: 'ja-s-023', level: 1, prompt: '日文很難', chunks: ['日本語', 'は', '難しいです'], legalOrders: [[0, 1, 2]] },

  /* ── pos：語境詞性（元気、まっすぐ、色々 各兩句，詞性不同） ── */
  { id: 'ja-x-075', mode: 'pos', sourceId: 'ja-w-293', level: 1, prompt: '畫線的字在這句裡是什麼詞性？', sentence: '今日は元気がありません。', targetWord: '元気', position: 3, options: POS, correctIndex: 0 },
  { id: 'ja-x-076', mode: 'pos', sourceId: 'ja-w-293', level: 1, prompt: '畫線的字在這句裡是什麼詞性？', sentence: '元気な子供が公園で遊びます。', targetWord: '元気', position: 0, options: POS, correctIndex: 3 },
  { id: 'ja-x-077', mode: 'pos', sourceId: 'ja-w-633', level: 1, prompt: '畫線的字在這句裡是什麼詞性？', sentence: 'この道をまっすぐ行ってください。', targetWord: 'まっすぐ', position: 4, options: POS, correctIndex: 4 },
  { id: 'ja-x-078', mode: 'pos', sourceId: 'ja-w-633', level: 1, prompt: '畫線的字在這句裡是什麼詞性？', sentence: 'これはまっすぐな道です。', targetWord: 'まっすぐ', position: 3, options: POS, correctIndex: 3 },
  { id: 'ja-x-079', mode: 'pos', sourceId: 'ja-w-147', level: 1, prompt: '畫線的字在這句裡是什麼詞性？', sentence: '色々な国へ行きました。', targetWord: '色々', position: 0, options: POS, correctIndex: 3 },
  { id: 'ja-x-080', mode: 'pos', sourceId: 'ja-w-147', level: 1, prompt: '畫線的字在這句裡是什麼詞性？', sentence: '色々教えてください。', targetWord: '色々', position: 0, options: POS, correctIndex: 4 },
  { id: 'ja-x-081', mode: 'pos', sourceId: 'ja-w-373', level: 1, prompt: '畫線的字在這句裡是什麼詞性？', sentence: '私は猫が好きです。', targetWord: '好き', position: 4, options: POS, correctIndex: 3 },
  { id: 'ja-x-082', mode: 'pos', sourceId: 'ja-w-138', level: 1, prompt: '畫線的字在這句裡是什麼詞性？', sentence: 'いつも七時に起きます。', targetWord: 'いつも', position: 0, options: POS, correctIndex: 4 },
  { id: 'ja-x-083', mode: 'pos', sourceId: 'ja-w-418', level: 1, prompt: '畫線的字在這句裡是什麼詞性？', sentence: 'この時計は高いです。', targetWord: '高い', position: 5, options: POS, correctIndex: 2 },
  { id: 'ja-x-084', mode: 'pos', sourceId: 'ja-w-034', level: 1, prompt: '畫線的字在這句裡是什麼詞性？', sentence: '私は毎朝パンを食べる。', targetWord: '食べる', position: 7, options: POS, correctIndex: 1 },
  { id: 'ja-x-085', mode: 'pos', sourceId: 'ja-w-041', level: 1, prompt: '畫線的字在這句裡是什麼詞性？', sentence: 'これは私の本です。', targetWord: '本', position: 5, options: POS, correctIndex: 0 },
  { id: 'ja-x-086', mode: 'pos', sourceId: 'ja-w-342', level: 1, prompt: '畫線的字在這句裡是什麼詞性？', sentence: '図書館は静かです。', targetWord: '静か', position: 4, options: POS, correctIndex: 3 },
];
