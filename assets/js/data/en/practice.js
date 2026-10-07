/**
 * 英文新題型的人工核對種子資料（目前只有 1 級）。
 *
 * 每一筆都引用既有題庫的真實 id：單字題引用 words.js，排句引用 sentences.js。
 * 題型與欄位：
 *   typing    看中文打英文；accepted 是人工白名單，caseSensitive 一律 false。
 *   listening 聽英文選中文；speakText 是朗讀文字，options 四個中文選項、correctIndex 指正解。
 *             同音字（tea／tee、morning／mourning 這類）一律不收，避免聽到的音對應兩個正解。
 *   dictation 聽英文打英文；accepted 是人工白名單。
 *   tiles     看中文拼字母；fragments 依正解順序列出（可重複，如 apple 的兩個 p），出題時才洗牌。
 *   reorder   看中文排句子；chunks 取自來源句，legalOrders 列出人工核對過的所有合法語序，
 *             第一個一定是原句語序。時間副詞（every day、today）放句首或句尾都合法。
 *   pos       語境詞性；position 是 targetWord 在 sentence 中的字元起點。
 *             run、book、light、hard、early、water 各有兩句、詞性不同。
 */

const POS = ['名詞', '動詞', '形容詞', '副詞'];

export const practice = [
  /* ── typing：看中文打英文 ── */
  { id: 'en-x-001', mode: 'typing', sourceId: 'en-w-001', level: 1, prompt: '麵包', accepted: ['bread'], caseSensitive: false },
  { id: 'en-x-002', mode: 'typing', sourceId: 'en-w-004', level: 1, prompt: '蘋果', accepted: ['apple'], caseSensitive: false },
  { id: 'en-x-003', mode: 'typing', sourceId: 'en-w-010', level: 1, prompt: '牛奶', accepted: ['milk'], caseSensitive: false },
  { id: 'en-x-004', mode: 'typing', sourceId: 'en-w-011', level: 1, prompt: '咖啡', accepted: ['coffee'], caseSensitive: false },
  { id: 'en-x-005', mode: 'typing', sourceId: 'en-w-015', level: 1, prompt: '貓', accepted: ['cat'], caseSensitive: false },
  { id: 'en-x-006', mode: 'typing', sourceId: 'en-w-014', level: 1, prompt: '狗', accepted: ['dog'], caseSensitive: false },
  { id: 'en-x-007', mode: 'typing', sourceId: 'en-w-016', level: 1, prompt: '鳥', accepted: ['bird'], caseSensitive: false },
  { id: 'en-x-008', mode: 'typing', sourceId: 'en-w-060', level: 1, prompt: '學校', accepted: ['school'], caseSensitive: false },
  { id: 'en-x-009', mode: 'typing', sourceId: 'en-w-061', level: 1, prompt: '醫院', accepted: ['hospital'], caseSensitive: false },
  { id: 'en-x-010', mode: 'typing', sourceId: 'en-w-003', level: 1, prompt: '蛋', accepted: ['egg'], caseSensitive: false },
  { id: 'en-x-011', mode: 'typing', sourceId: 'en-w-070', level: 1, prompt: '明天', accepted: ['tomorrow'], caseSensitive: false },
  { id: 'en-x-012', mode: 'typing', sourceId: 'en-w-054', level: 1, prompt: '媽媽', accepted: ['mother', 'mom', 'mum'], caseSensitive: false },

  /* ── listening：聽英文選中文 ── */
  { id: 'en-x-013', mode: 'listening', sourceId: 'en-w-004', level: 1, prompt: '聽發音，選出中文意思', speakText: 'apple', options: ['蘋果', '麵包', '牛奶', '蛋'], correctIndex: 0 },
  { id: 'en-x-014', mode: 'listening', sourceId: 'en-w-001', level: 1, prompt: '聽發音，選出中文意思', speakText: 'bread', options: ['米飯', '麵包', '咖啡', '蘋果'], correctIndex: 1 },
  { id: 'en-x-015', mode: 'listening', sourceId: 'en-w-010', level: 1, prompt: '聽發音，選出中文意思', speakText: 'milk', options: ['水', '咖啡', '牛奶', '麵包'], correctIndex: 2 },
  { id: 'en-x-016', mode: 'listening', sourceId: 'en-w-011', level: 1, prompt: '聽發音，選出中文意思', speakText: 'coffee', options: ['牛奶', '水', '蛋', '咖啡'], correctIndex: 3 },
  { id: 'en-x-017', mode: 'listening', sourceId: 'en-w-014', level: 1, prompt: '聽發音，選出中文意思', speakText: 'dog', options: ['狗', '貓', '鳥', '汽車'], correctIndex: 0 },
  { id: 'en-x-018', mode: 'listening', sourceId: 'en-w-016', level: 1, prompt: '聽發音，選出中文意思', speakText: 'bird', options: ['貓', '鳥', '狗', '公車'], correctIndex: 1 },
  { id: 'en-x-019', mode: 'listening', sourceId: 'en-w-060', level: 1, prompt: '聽發音，選出中文意思', speakText: 'school', options: ['醫院', '車站', '學校', '公園'], correctIndex: 2 },
  { id: 'en-x-020', mode: 'listening', sourceId: 'en-w-061', level: 1, prompt: '聽發音，選出中文意思', speakText: 'hospital', options: ['學校', '公園', '車站', '醫院'], correctIndex: 3 },
  { id: 'en-x-021', mode: 'listening', sourceId: 'en-w-062', level: 1, prompt: '聽發音，選出中文意思', speakText: 'station', options: ['車站', '學校', '醫院', '公園'], correctIndex: 0 },
  { id: 'en-x-022', mode: 'listening', sourceId: 'en-w-070', level: 1, prompt: '聽發音，選出中文意思', speakText: 'tomorrow', options: ['今天', '明天', '早上', '晚上'], correctIndex: 1 },
  { id: 'en-x-023', mode: 'listening', sourceId: 'en-w-079', level: 1, prompt: '聽發音，選出中文意思', speakText: 'green', options: ['紅色', '藍色', '綠色', '黃色'], correctIndex: 2 },
  { id: 'en-x-024', mode: 'listening', sourceId: 'en-w-021', level: 1, prompt: '聽發音，選出中文意思', speakText: 'basketball', options: ['足球', '羽毛球', '火車', '籃球'], correctIndex: 3 },

  /* ── dictation：聽英文打英文 ── */
  { id: 'en-x-025', mode: 'dictation', sourceId: 'en-w-004', level: 1, prompt: '聽發音，打出英文', speakText: 'apple', accepted: ['apple'] },
  { id: 'en-x-026', mode: 'dictation', sourceId: 'en-w-001', level: 1, prompt: '聽發音，打出英文', speakText: 'bread', accepted: ['bread'] },
  { id: 'en-x-027', mode: 'dictation', sourceId: 'en-w-008', level: 1, prompt: '聽發音，打出英文', speakText: 'water', accepted: ['water'] },
  { id: 'en-x-028', mode: 'dictation', sourceId: 'en-w-011', level: 1, prompt: '聽發音，打出英文', speakText: 'coffee', accepted: ['coffee'] },
  { id: 'en-x-029', mode: 'dictation', sourceId: 'en-w-060', level: 1, prompt: '聽發音，打出英文', speakText: 'school', accepted: ['school'] },
  { id: 'en-x-030', mode: 'dictation', sourceId: 'en-w-062', level: 1, prompt: '聽發音，打出英文', speakText: 'station', accepted: ['station'] },
  { id: 'en-x-031', mode: 'dictation', sourceId: 'en-w-080', level: 1, prompt: '聽發音，打出英文', speakText: 'yellow', accepted: ['yellow'] },
  { id: 'en-x-032', mode: 'dictation', sourceId: 'en-w-061', level: 1, prompt: '聽發音，打出英文', speakText: 'hospital', accepted: ['hospital'] },
  { id: 'en-x-033', mode: 'dictation', sourceId: 'en-w-021', level: 1, prompt: '聽發音，打出英文', speakText: 'basketball', accepted: ['basketball'] },
  { id: 'en-x-034', mode: 'dictation', sourceId: 'en-w-1489', level: 1, prompt: '聽發音，打出英文', speakText: 'family', accepted: ['family'] },
  { id: 'en-x-035', mode: 'dictation', sourceId: 'en-w-1791', level: 1, prompt: '聽發音，打出英文', speakText: 'teacher', accepted: ['teacher'] },
  { id: 'en-x-036', mode: 'dictation', sourceId: 'en-w-070', level: 1, prompt: '聽發音，打出英文', speakText: 'tomorrow', accepted: ['tomorrow'] },

  /* ── tiles：看中文拼字母 ── */
  { id: 'en-x-037', mode: 'tiles', sourceId: 'en-w-004', level: 1, prompt: '蘋果', fragments: ['a', 'p', 'p', 'l', 'e'], answer: 'apple' },
  { id: 'en-x-038', mode: 'tiles', sourceId: 'en-w-003', level: 1, prompt: '蛋', fragments: ['e', 'g', 'g'], answer: 'egg' },
  { id: 'en-x-039', mode: 'tiles', sourceId: 'en-w-011', level: 1, prompt: '咖啡', fragments: ['c', 'o', 'f', 'f', 'e', 'e'], answer: 'coffee' },
  { id: 'en-x-040', mode: 'tiles', sourceId: 'en-w-079', level: 1, prompt: '綠色', fragments: ['g', 'r', 'e', 'e', 'n'], answer: 'green' },
  { id: 'en-x-041', mode: 'tiles', sourceId: 'en-w-060', level: 1, prompt: '學校', fragments: ['s', 'c', 'h', 'o', 'o', 'l'], answer: 'school' },
  { id: 'en-x-042', mode: 'tiles', sourceId: 'en-w-001', level: 1, prompt: '麵包', fragments: ['b', 'r', 'e', 'a', 'd'], answer: 'bread' },
  { id: 'en-x-043', mode: 'tiles', sourceId: 'en-w-010', level: 1, prompt: '牛奶', fragments: ['m', 'i', 'l', 'k'], answer: 'milk' },
  { id: 'en-x-044', mode: 'tiles', sourceId: 'en-w-080', level: 1, prompt: '黃色', fragments: ['y', 'e', 'l', 'l', 'o', 'w'], answer: 'yellow' },
  { id: 'en-x-045', mode: 'tiles', sourceId: 'en-w-034', level: 1, prompt: '睡覺', fragments: ['s', 'l', 'e', 'e', 'p'], answer: 'sleep' },
  { id: 'en-x-046', mode: 'tiles', sourceId: 'en-w-008', level: 1, prompt: '水', fragments: ['w', 'a', 't', 'e', 'r'], answer: 'water' },
  { id: 'en-x-047', mode: 'tiles', sourceId: 'en-w-014', level: 1, prompt: '狗', fragments: ['d', 'o', 'g'], answer: 'dog' },
  { id: 'en-x-048', mode: 'tiles', sourceId: 'en-w-070', level: 1, prompt: '明天', fragments: ['t', 'o', 'm', 'o', 'r', 'r', 'o', 'w'], answer: 'tomorrow' },

  /* ── reorder：看中文排句子（chunks 取自 sentences.js 的來源句） ── */
  { id: 'en-x-049', mode: 'reorder', sourceId: 'en-s-001', level: 1, prompt: '我喝咖啡', chunks: ['I', 'drink', 'coffee'], legalOrders: [[0, 1, 2]] },
  { id: 'en-x-050', mode: 'reorder', sourceId: 'en-s-002', level: 1, prompt: '她養了一隻貓', chunks: ['She', 'has', 'a cat'], legalOrders: [[0, 1, 2]] },
  { id: 'en-x-051', mode: 'reorder', sourceId: 'en-s-003', level: 1, prompt: '他吃早餐', chunks: ['He', 'eats', 'breakfast'], legalOrders: [[0, 1, 2]] },
  { id: 'en-x-052', mode: 'reorder', sourceId: 'en-s-004', level: 1, prompt: '我們看電影', chunks: ['We', 'watch', 'a movie'], legalOrders: [[0, 1, 2]] },
  { id: 'en-x-053', mode: 'reorder', sourceId: 'en-s-005', level: 1, prompt: '媽媽開車', chunks: ['My mother', 'drives', 'a car'], legalOrders: [[0, 1, 2]] },
  /* 時間副詞 every day 可放句尾或句首 */
  { id: 'en-x-054', mode: 'reorder', sourceId: 'en-s-010', level: 1, prompt: '我每天喝牛奶', chunks: ['I', 'drink', 'milk', 'every day'], legalOrders: [[0, 1, 2, 3], [3, 0, 1, 2]] },
  /* 時間副詞 today 可放句尾或句首 */
  { id: 'en-x-055', mode: 'reorder', sourceId: 'en-s-028', level: 1, prompt: '我今天去打羽毛球', chunks: ['I', 'play', 'badminton', 'today'], legalOrders: [[0, 1, 2, 3], [3, 0, 1, 2]] },
  { id: 'en-x-056', mode: 'reorder', sourceId: 'en-s-029', level: 1, prompt: '我讀報紙', chunks: ['I', 'read', 'the newspaper'], legalOrders: [[0, 1, 2]] },
  { id: 'en-x-057', mode: 'reorder', sourceId: 'en-s-033', level: 1, prompt: '我們學日文', chunks: ['We', 'study', 'Japanese'], legalOrders: [[0, 1, 2]] },
  { id: 'en-x-058', mode: 'reorder', sourceId: 'en-s-037', level: 1, prompt: '我喜歡巧克力', chunks: ['I', 'like', 'chocolate'], legalOrders: [[0, 1, 2]] },
  { id: 'en-x-059', mode: 'reorder', sourceId: 'en-s-044', level: 1, prompt: '我關窗戶', chunks: ['I', 'close', 'the window'], legalOrders: [[0, 1, 2]] },
  { id: 'en-x-060', mode: 'reorder', sourceId: 'en-s-072', level: 1, prompt: '我不吃肉', chunks: ['I', 'do not', 'eat', 'meat'], legalOrders: [[0, 1, 2, 3]] },

  /* ── pos：語境詞性（同一個字在不同句子裡詞性不同） ── */
  { id: 'en-x-061', mode: 'pos', sourceId: 'en-w-1508', level: 1, prompt: '畫線的字在這句裡是什麼詞性？', sentence: 'I run in the park every morning.', targetWord: 'run', position: 2, options: POS, correctIndex: 1 },
  { id: 'en-x-062', mode: 'pos', sourceId: 'en-w-1508', level: 1, prompt: '畫線的字在這句裡是什麼詞性？', sentence: 'I go for a run every morning.', targetWord: 'run', position: 11, options: POS, correctIndex: 0 },
  { id: 'en-x-063', mode: 'pos', sourceId: 'en-w-1488', level: 1, prompt: '畫線的字在這句裡是什麼詞性？', sentence: 'This book is interesting.', targetWord: 'book', position: 5, options: POS, correctIndex: 0 },
  { id: 'en-x-064', mode: 'pos', sourceId: 'en-w-1488', level: 1, prompt: '畫線的字在這句裡是什麼詞性？', sentence: 'Please book a table for two.', targetWord: 'book', position: 7, options: POS, correctIndex: 1 },
  { id: 'en-x-065', mode: 'pos', sourceId: 'en-w-1651', level: 1, prompt: '畫線的字在這句裡是什麼詞性？', sentence: 'Please turn on the light.', targetWord: 'light', position: 19, options: POS, correctIndex: 0 },
  { id: 'en-x-066', mode: 'pos', sourceId: 'en-w-1651', level: 1, prompt: '畫線的字在這句裡是什麼詞性？', sentence: 'This bag is very light.', targetWord: 'light', position: 17, options: POS, correctIndex: 2 },
  { id: 'en-x-067', mode: 'pos', sourceId: 'en-w-1603', level: 1, prompt: '畫線的字在這句裡是什麼詞性？', sentence: 'The test is hard.', targetWord: 'hard', position: 12, options: POS, correctIndex: 2 },
  { id: 'en-x-068', mode: 'pos', sourceId: 'en-w-1603', level: 1, prompt: '畫線的字在這句裡是什麼詞性？', sentence: 'She works hard every day.', targetWord: 'hard', position: 10, options: POS, correctIndex: 3 },
  { id: 'en-x-069', mode: 'pos', sourceId: 'en-w-1513', level: 1, prompt: '畫線的字在這句裡是什麼詞性？', sentence: 'I get up early.', targetWord: 'early', position: 9, options: POS, correctIndex: 3 },
  { id: 'en-x-070', mode: 'pos', sourceId: 'en-w-1513', level: 1, prompt: '畫線的字在這句裡是什麼詞性？', sentence: 'I take the early train.', targetWord: 'early', position: 11, options: POS, correctIndex: 2 },
  { id: 'en-x-071', mode: 'pos', sourceId: 'en-w-008', level: 1, prompt: '畫線的字在這句裡是什麼詞性？', sentence: 'I drink water every day.', targetWord: 'water', position: 8, options: POS, correctIndex: 0 },
  { id: 'en-x-072', mode: 'pos', sourceId: 'en-w-008', level: 1, prompt: '畫線的字在這句裡是什麼詞性？', sentence: 'I water the flowers every morning.', targetWord: 'water', position: 2, options: POS, correctIndex: 1 },
];
