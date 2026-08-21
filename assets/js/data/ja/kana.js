/**
 * 日文假名表，共 104 筆：清音 46、濁音 20、半濁音 5、拗音 33。
 *
 * 欄位說明：
 * - id           固定 'ja-k-<romaji>'，因為 romaji 全表唯一，所以 id 也唯一
 * - hiragana     平假名，拗音為兩個字元（例 'きゃ'）
 * - katakana     片假名，拗音同樣兩個字元（例 'キャ'）
 * - romaji       Hepburn 式羅馬拼音，全表不得重複
 * - type         'seion' / 'dakuon' / 'handakuon' / 'youon'
 * - row          清濁半濁音用行首假名；拗音用其子音假名（'き'、'し'、…、'ぴ'）
 * - column       清濁半濁音為 'a'/'i'/'u'/'e'/'o'；拗音為 'ya'/'yu'/'yo'
 * - seionSource  濁音／半濁音的清音來源平假名；清音與拗音為 null
 * - exampleWord  例字，一律用假名書寫（不用漢字），這個欄位會拿去朗讀
 * - exampleZh    例字的繁體中文意思
 *
 * 特別註記：
 * ぢ 的標準 Hepburn 寫法與 じ 同為 'ji'、づ 與 ず 同為 'zu'，
 * 為了讓 romaji 與 id 保持唯一，這裡改採 'di' 與 'du'。
 * 另外現代日語幾乎不用的 ぢゃ／ぢゅ／ぢょ 不收錄，所以拗音是 33 筆而非 36 筆。
 */
export const kana = [
  // ===== 清音 seion（46 筆）=====

  // あ行
  { id: 'ja-k-a', hiragana: 'あ', katakana: 'ア', romaji: 'a',
    type: 'seion', row: 'あ', column: 'a', seionSource: null,
    exampleWord: 'あめ', exampleZh: '雨' },
  { id: 'ja-k-i', hiragana: 'い', katakana: 'イ', romaji: 'i',
    type: 'seion', row: 'あ', column: 'i', seionSource: null,
    exampleWord: 'いえ', exampleZh: '家' },
  { id: 'ja-k-u', hiragana: 'う', katakana: 'ウ', romaji: 'u',
    type: 'seion', row: 'あ', column: 'u', seionSource: null,
    exampleWord: 'うみ', exampleZh: '海' },
  { id: 'ja-k-e', hiragana: 'え', katakana: 'エ', romaji: 'e',
    type: 'seion', row: 'あ', column: 'e', seionSource: null,
    exampleWord: 'えき', exampleZh: '車站' },
  { id: 'ja-k-o', hiragana: 'お', katakana: 'オ', romaji: 'o',
    type: 'seion', row: 'あ', column: 'o', seionSource: null,
    exampleWord: 'おかね', exampleZh: '錢' },

  // か行
  { id: 'ja-k-ka', hiragana: 'か', katakana: 'カ', romaji: 'ka',
    type: 'seion', row: 'か', column: 'a', seionSource: null,
    exampleWord: 'かさ', exampleZh: '雨傘' },
  { id: 'ja-k-ki', hiragana: 'き', katakana: 'キ', romaji: 'ki',
    type: 'seion', row: 'か', column: 'i', seionSource: null,
    exampleWord: 'きって', exampleZh: '郵票' },
  { id: 'ja-k-ku', hiragana: 'く', katakana: 'ク', romaji: 'ku',
    type: 'seion', row: 'か', column: 'u', seionSource: null,
    exampleWord: 'くつ', exampleZh: '鞋子' },
  { id: 'ja-k-ke', hiragana: 'け', katakana: 'ケ', romaji: 'ke',
    type: 'seion', row: 'か', column: 'e', seionSource: null,
    exampleWord: 'けむり', exampleZh: '煙' },
  { id: 'ja-k-ko', hiragana: 'こ', katakana: 'コ', romaji: 'ko',
    type: 'seion', row: 'か', column: 'o', seionSource: null,
    exampleWord: 'こども', exampleZh: '小孩' },

  // さ行
  { id: 'ja-k-sa', hiragana: 'さ', katakana: 'サ', romaji: 'sa',
    type: 'seion', row: 'さ', column: 'a', seionSource: null,
    exampleWord: 'さかな', exampleZh: '魚' },
  { id: 'ja-k-shi', hiragana: 'し', katakana: 'シ', romaji: 'shi',
    type: 'seion', row: 'さ', column: 'i', seionSource: null,
    exampleWord: 'しごと', exampleZh: '工作' },
  { id: 'ja-k-su', hiragana: 'す', katakana: 'ス', romaji: 'su',
    type: 'seion', row: 'さ', column: 'u', seionSource: null,
    exampleWord: 'すいか', exampleZh: '西瓜' },
  { id: 'ja-k-se', hiragana: 'せ', katakana: 'セ', romaji: 'se',
    type: 'seion', row: 'さ', column: 'e', seionSource: null,
    exampleWord: 'せかい', exampleZh: '世界' },
  { id: 'ja-k-so', hiragana: 'そ', katakana: 'ソ', romaji: 'so',
    type: 'seion', row: 'さ', column: 'o', seionSource: null,
    exampleWord: 'そら', exampleZh: '天空' },

  // た行
  { id: 'ja-k-ta', hiragana: 'た', katakana: 'タ', romaji: 'ta',
    type: 'seion', row: 'た', column: 'a', seionSource: null,
    exampleWord: 'たまご', exampleZh: '蛋' },
  { id: 'ja-k-chi', hiragana: 'ち', katakana: 'チ', romaji: 'chi',
    type: 'seion', row: 'た', column: 'i', seionSource: null,
    exampleWord: 'ちず', exampleZh: '地圖' },
  { id: 'ja-k-tsu', hiragana: 'つ', katakana: 'ツ', romaji: 'tsu',
    type: 'seion', row: 'た', column: 'u', seionSource: null,
    exampleWord: 'つくえ', exampleZh: '書桌' },
  { id: 'ja-k-te', hiragana: 'て', katakana: 'テ', romaji: 'te',
    type: 'seion', row: 'た', column: 'e', seionSource: null,
    exampleWord: 'てがみ', exampleZh: '信' },
  { id: 'ja-k-to', hiragana: 'と', katakana: 'ト', romaji: 'to',
    type: 'seion', row: 'た', column: 'o', seionSource: null,
    exampleWord: 'とけい', exampleZh: '時鐘' },

  // な行
  { id: 'ja-k-na', hiragana: 'な', katakana: 'ナ', romaji: 'na',
    type: 'seion', row: 'な', column: 'a', seionSource: null,
    exampleWord: 'なつ', exampleZh: '夏天' },
  { id: 'ja-k-ni', hiragana: 'に', katakana: 'ニ', romaji: 'ni',
    type: 'seion', row: 'な', column: 'i', seionSource: null,
    exampleWord: 'にく', exampleZh: '肉' },
  { id: 'ja-k-nu', hiragana: 'ぬ', katakana: 'ヌ', romaji: 'nu',
    type: 'seion', row: 'な', column: 'u', seionSource: null,
    exampleWord: 'ぬの', exampleZh: '布' },
  { id: 'ja-k-ne', hiragana: 'ね', katakana: 'ネ', romaji: 'ne',
    type: 'seion', row: 'な', column: 'e', seionSource: null,
    exampleWord: 'ねこ', exampleZh: '貓' },
  { id: 'ja-k-no', hiragana: 'の', katakana: 'ノ', romaji: 'no',
    type: 'seion', row: 'な', column: 'o', seionSource: null,
    exampleWord: 'のり', exampleZh: '海苔' },

  // は行
  { id: 'ja-k-ha', hiragana: 'は', katakana: 'ハ', romaji: 'ha',
    type: 'seion', row: 'は', column: 'a', seionSource: null,
    exampleWord: 'はな', exampleZh: '花' },
  { id: 'ja-k-hi', hiragana: 'ひ', katakana: 'ヒ', romaji: 'hi',
    type: 'seion', row: 'は', column: 'i', seionSource: null,
    exampleWord: 'ひと', exampleZh: '人' },
  { id: 'ja-k-fu', hiragana: 'ふ', katakana: 'フ', romaji: 'fu',
    type: 'seion', row: 'は', column: 'u', seionSource: null,
    exampleWord: 'ふゆ', exampleZh: '冬天' },
  { id: 'ja-k-he', hiragana: 'へ', katakana: 'ヘ', romaji: 'he',
    type: 'seion', row: 'は', column: 'e', seionSource: null,
    exampleWord: 'へや', exampleZh: '房間' },
  { id: 'ja-k-ho', hiragana: 'ほ', katakana: 'ホ', romaji: 'ho',
    type: 'seion', row: 'は', column: 'o', seionSource: null,
    exampleWord: 'ほし', exampleZh: '星星' },

  // ま行
  { id: 'ja-k-ma', hiragana: 'ま', katakana: 'マ', romaji: 'ma',
    type: 'seion', row: 'ま', column: 'a', seionSource: null,
    exampleWord: 'まど', exampleZh: '窗戶' },
  { id: 'ja-k-mi', hiragana: 'み', katakana: 'ミ', romaji: 'mi',
    type: 'seion', row: 'ま', column: 'i', seionSource: null,
    exampleWord: 'みかん', exampleZh: '橘子' },
  { id: 'ja-k-mu', hiragana: 'む', katakana: 'ム', romaji: 'mu',
    type: 'seion', row: 'ま', column: 'u', seionSource: null,
    exampleWord: 'むし', exampleZh: '蟲' },
  { id: 'ja-k-me', hiragana: 'め', katakana: 'メ', romaji: 'me',
    type: 'seion', row: 'ま', column: 'e', seionSource: null,
    exampleWord: 'めがね', exampleZh: '眼鏡' },
  { id: 'ja-k-mo', hiragana: 'も', katakana: 'モ', romaji: 'mo',
    type: 'seion', row: 'ま', column: 'o', seionSource: null,
    exampleWord: 'もり', exampleZh: '森林' },

  // や行（只有 a／u／o 三段）
  { id: 'ja-k-ya', hiragana: 'や', katakana: 'ヤ', romaji: 'ya',
    type: 'seion', row: 'や', column: 'a', seionSource: null,
    exampleWord: 'やま', exampleZh: '山' },
  { id: 'ja-k-yu', hiragana: 'ゆ', katakana: 'ユ', romaji: 'yu',
    type: 'seion', row: 'や', column: 'u', seionSource: null,
    exampleWord: 'ゆき', exampleZh: '雪' },
  { id: 'ja-k-yo', hiragana: 'よ', katakana: 'ヨ', romaji: 'yo',
    type: 'seion', row: 'や', column: 'o', seionSource: null,
    exampleWord: 'よる', exampleZh: '夜晚' },

  // ら行
  { id: 'ja-k-ra', hiragana: 'ら', katakana: 'ラ', romaji: 'ra',
    type: 'seion', row: 'ら', column: 'a', seionSource: null,
    exampleWord: 'らくだ', exampleZh: '駱駝' },
  { id: 'ja-k-ri', hiragana: 'り', katakana: 'リ', romaji: 'ri',
    type: 'seion', row: 'ら', column: 'i', seionSource: null,
    exampleWord: 'りんご', exampleZh: '蘋果' },
  { id: 'ja-k-ru', hiragana: 'る', katakana: 'ル', romaji: 'ru',
    type: 'seion', row: 'ら', column: 'u', seionSource: null,
    exampleWord: 'るす', exampleZh: '不在家' },
  { id: 'ja-k-re', hiragana: 'れ', katakana: 'レ', romaji: 're',
    type: 'seion', row: 'ら', column: 'e', seionSource: null,
    exampleWord: 'れきし', exampleZh: '歷史' },
  { id: 'ja-k-ro', hiragana: 'ろ', katakana: 'ロ', romaji: 'ro',
    type: 'seion', row: 'ら', column: 'o', seionSource: null,
    exampleWord: 'ろうそく', exampleZh: '蠟燭' },

  // わ行（只有 a／o 兩段）
  { id: 'ja-k-wa', hiragana: 'わ', katakana: 'ワ', romaji: 'wa',
    type: 'seion', row: 'わ', column: 'a', seionSource: null,
    exampleWord: 'わたし', exampleZh: '我' },
  { id: 'ja-k-wo', hiragana: 'を', katakana: 'ヲ', romaji: 'wo',
    type: 'seion', row: 'わ', column: 'o', seionSource: null,
    exampleWord: 'ほんをよむ', exampleZh: '讀書' },

  // 撥音
  { id: 'ja-k-n', hiragana: 'ん', katakana: 'ン', romaji: 'n',
    type: 'seion', row: 'ん', column: 'a', seionSource: null,
    exampleWord: 'ほん', exampleZh: '書' },

  // ===== 濁音 dakuon（20 筆）=====

  // が行
  { id: 'ja-k-ga', hiragana: 'が', katakana: 'ガ', romaji: 'ga',
    type: 'dakuon', row: 'が', column: 'a', seionSource: 'か',
    exampleWord: 'がっこう', exampleZh: '學校' },
  { id: 'ja-k-gi', hiragana: 'ぎ', katakana: 'ギ', romaji: 'gi',
    type: 'dakuon', row: 'が', column: 'i', seionSource: 'き',
    exampleWord: 'ぎんこう', exampleZh: '銀行' },
  { id: 'ja-k-gu', hiragana: 'ぐ', katakana: 'グ', romaji: 'gu',
    type: 'dakuon', row: 'が', column: 'u', seionSource: 'く',
    exampleWord: 'かぐ', exampleZh: '家具' },
  { id: 'ja-k-ge', hiragana: 'げ', katakana: 'ゲ', romaji: 'ge',
    type: 'dakuon', row: 'が', column: 'e', seionSource: 'け',
    exampleWord: 'げんき', exampleZh: '有精神' },
  { id: 'ja-k-go', hiragana: 'ご', katakana: 'ゴ', romaji: 'go',
    type: 'dakuon', row: 'が', column: 'o', seionSource: 'こ',
    exampleWord: 'ごはん', exampleZh: '飯' },

  // ざ行
  { id: 'ja-k-za', hiragana: 'ざ', katakana: 'ザ', romaji: 'za',
    type: 'dakuon', row: 'ざ', column: 'a', seionSource: 'さ',
    exampleWord: 'ざっし', exampleZh: '雜誌' },
  { id: 'ja-k-ji', hiragana: 'じ', katakana: 'ジ', romaji: 'ji',
    type: 'dakuon', row: 'ざ', column: 'i', seionSource: 'し',
    exampleWord: 'じかん', exampleZh: '時間' },
  { id: 'ja-k-zu', hiragana: 'ず', katakana: 'ズ', romaji: 'zu',
    type: 'dakuon', row: 'ざ', column: 'u', seionSource: 'す',
    exampleWord: 'みず', exampleZh: '水' },
  { id: 'ja-k-ze', hiragana: 'ぜ', katakana: 'ゼ', romaji: 'ze',
    type: 'dakuon', row: 'ざ', column: 'e', seionSource: 'せ',
    exampleWord: 'かぜ', exampleZh: '風' },
  { id: 'ja-k-zo', hiragana: 'ぞ', katakana: 'ゾ', romaji: 'zo',
    type: 'dakuon', row: 'ざ', column: 'o', seionSource: 'そ',
    exampleWord: 'ぞう', exampleZh: '大象' },

  // だ行（ぢ 用 di、づ 用 du，避開與 じ／ず 的 romaji 重複）
  { id: 'ja-k-da', hiragana: 'だ', katakana: 'ダ', romaji: 'da',
    type: 'dakuon', row: 'だ', column: 'a', seionSource: 'た',
    exampleWord: 'だいがく', exampleZh: '大學' },
  { id: 'ja-k-di', hiragana: 'ぢ', katakana: 'ヂ', romaji: 'di',
    type: 'dakuon', row: 'だ', column: 'i', seionSource: 'ち',
    exampleWord: 'はなぢ', exampleZh: '流鼻血' },
  { id: 'ja-k-du', hiragana: 'づ', katakana: 'ヅ', romaji: 'du',
    type: 'dakuon', row: 'だ', column: 'u', seionSource: 'つ',
    exampleWord: 'つづく', exampleZh: '繼續' },
  { id: 'ja-k-de', hiragana: 'で', katakana: 'デ', romaji: 'de',
    type: 'dakuon', row: 'だ', column: 'e', seionSource: 'て',
    exampleWord: 'でんわ', exampleZh: '電話' },
  { id: 'ja-k-do', hiragana: 'ど', katakana: 'ド', romaji: 'do',
    type: 'dakuon', row: 'だ', column: 'o', seionSource: 'と',
    exampleWord: 'どようび', exampleZh: '星期六' },

  // ば行
  { id: 'ja-k-ba', hiragana: 'ば', katakana: 'バ', romaji: 'ba',
    type: 'dakuon', row: 'ば', column: 'a', seionSource: 'は',
    exampleWord: 'ばら', exampleZh: '玫瑰' },
  { id: 'ja-k-bi', hiragana: 'び', katakana: 'ビ', romaji: 'bi',
    type: 'dakuon', row: 'ば', column: 'i', seionSource: 'ひ',
    exampleWord: 'えび', exampleZh: '蝦子' },
  { id: 'ja-k-bu', hiragana: 'ぶ', katakana: 'ブ', romaji: 'bu',
    type: 'dakuon', row: 'ば', column: 'u', seionSource: 'ふ',
    exampleWord: 'ぶた', exampleZh: '豬' },
  { id: 'ja-k-be', hiragana: 'べ', katakana: 'ベ', romaji: 'be',
    type: 'dakuon', row: 'ば', column: 'e', seionSource: 'へ',
    exampleWord: 'べんとう', exampleZh: '便當' },
  { id: 'ja-k-bo', hiragana: 'ぼ', katakana: 'ボ', romaji: 'bo',
    type: 'dakuon', row: 'ば', column: 'o', seionSource: 'ほ',
    exampleWord: 'ぼうし', exampleZh: '帽子' },

  // ===== 半濁音 handakuon（5 筆）=====

  // ぱ行
  { id: 'ja-k-pa', hiragana: 'ぱ', katakana: 'パ', romaji: 'pa',
    type: 'handakuon', row: 'ぱ', column: 'a', seionSource: 'は',
    exampleWord: 'パン', exampleZh: '麵包' },
  { id: 'ja-k-pi', hiragana: 'ぴ', katakana: 'ピ', romaji: 'pi',
    type: 'handakuon', row: 'ぱ', column: 'i', seionSource: 'ひ',
    exampleWord: 'えんぴつ', exampleZh: '鉛筆' },
  { id: 'ja-k-pu', hiragana: 'ぷ', katakana: 'プ', romaji: 'pu',
    type: 'handakuon', row: 'ぱ', column: 'u', seionSource: 'ふ',
    exampleWord: 'てんぷら', exampleZh: '天婦羅' },
  { id: 'ja-k-pe', hiragana: 'ぺ', katakana: 'ペ', romaji: 'pe',
    type: 'handakuon', row: 'ぱ', column: 'e', seionSource: 'へ',
    exampleWord: 'ペン', exampleZh: '筆' },
  { id: 'ja-k-po', hiragana: 'ぽ', katakana: 'ポ', romaji: 'po',
    type: 'handakuon', row: 'ぱ', column: 'o', seionSource: 'ほ',
    exampleWord: 'さんぽ', exampleZh: '散步' },

  // ===== 拗音 youon（33 筆，不收 ぢゃ／ぢゅ／ぢょ）=====

  // き行
  { id: 'ja-k-kya', hiragana: 'きゃ', katakana: 'キャ', romaji: 'kya',
    type: 'youon', row: 'き', column: 'ya', seionSource: null,
    exampleWord: 'きゃく', exampleZh: '客人' },
  { id: 'ja-k-kyu', hiragana: 'きゅ', katakana: 'キュ', romaji: 'kyu',
    type: 'youon', row: 'き', column: 'yu', seionSource: null,
    exampleWord: 'きゅうり', exampleZh: '小黃瓜' },
  { id: 'ja-k-kyo', hiragana: 'きょ', katakana: 'キョ', romaji: 'kyo',
    type: 'youon', row: 'き', column: 'yo', seionSource: null,
    exampleWord: 'きょう', exampleZh: '今天' },

  // し行
  { id: 'ja-k-sha', hiragana: 'しゃ', katakana: 'シャ', romaji: 'sha',
    type: 'youon', row: 'し', column: 'ya', seionSource: null,
    exampleWord: 'しゃしん', exampleZh: '照片' },
  { id: 'ja-k-shu', hiragana: 'しゅ', katakana: 'シュ', romaji: 'shu',
    type: 'youon', row: 'し', column: 'yu', seionSource: null,
    exampleWord: 'しゅみ', exampleZh: '興趣' },
  { id: 'ja-k-sho', hiragana: 'しょ', katakana: 'ショ', romaji: 'sho',
    type: 'youon', row: 'し', column: 'yo', seionSource: null,
    exampleWord: 'しょくじ', exampleZh: '用餐' },

  // ち行
  { id: 'ja-k-cha', hiragana: 'ちゃ', katakana: 'チャ', romaji: 'cha',
    type: 'youon', row: 'ち', column: 'ya', seionSource: null,
    exampleWord: 'おちゃ', exampleZh: '茶' },
  { id: 'ja-k-chu', hiragana: 'ちゅ', katakana: 'チュ', romaji: 'chu',
    type: 'youon', row: 'ち', column: 'yu', seionSource: null,
    exampleWord: 'ちゅうい', exampleZh: '注意' },
  { id: 'ja-k-cho', hiragana: 'ちょ', katakana: 'チョ', romaji: 'cho',
    type: 'youon', row: 'ち', column: 'yo', seionSource: null,
    exampleWord: 'ちょきん', exampleZh: '存款' },

  // に行
  { id: 'ja-k-nya', hiragana: 'にゃ', katakana: 'ニャ', romaji: 'nya',
    type: 'youon', row: 'に', column: 'ya', seionSource: null,
    exampleWord: 'にゃんこ', exampleZh: '貓咪' },
  { id: 'ja-k-nyu', hiragana: 'にゅ', katakana: 'ニュ', romaji: 'nyu',
    type: 'youon', row: 'に', column: 'yu', seionSource: null,
    exampleWord: 'にゅうがく', exampleZh: '入學' },
  { id: 'ja-k-nyo', hiragana: 'にょ', katakana: 'ニョ', romaji: 'nyo',
    type: 'youon', row: 'に', column: 'yo', seionSource: null,
    exampleWord: 'にょうぼう', exampleZh: '妻子' },

  // ひ行
  { id: 'ja-k-hya', hiragana: 'ひゃ', katakana: 'ヒャ', romaji: 'hya',
    type: 'youon', row: 'ひ', column: 'ya', seionSource: null,
    exampleWord: 'ひゃく', exampleZh: '一百' },
  { id: 'ja-k-hyu', hiragana: 'ひゅ', katakana: 'ヒュ', romaji: 'hyu',
    type: 'youon', row: 'ひ', column: 'yu', seionSource: null,
    exampleWord: 'ひゅうひゅう', exampleZh: '風呼呼地吹' },
  { id: 'ja-k-hyo', hiragana: 'ひょ', katakana: 'ヒョ', romaji: 'hyo',
    type: 'youon', row: 'ひ', column: 'yo', seionSource: null,
    exampleWord: 'ひょうざん', exampleZh: '冰山' },

  // み行
  { id: 'ja-k-mya', hiragana: 'みゃ', katakana: 'ミャ', romaji: 'mya',
    type: 'youon', row: 'み', column: 'ya', seionSource: null,
    exampleWord: 'みゃく', exampleZh: '脈搏' },
  { id: 'ja-k-myu', hiragana: 'みゅ', katakana: 'ミュ', romaji: 'myu',
    type: 'youon', row: 'み', column: 'yu', seionSource: null,
    exampleWord: 'ミュージック', exampleZh: '音樂' },
  { id: 'ja-k-myo', hiragana: 'みょ', katakana: 'ミョ', romaji: 'myo',
    type: 'youon', row: 'み', column: 'yo', seionSource: null,
    exampleWord: 'みょうじ', exampleZh: '姓氏' },

  // り行
  { id: 'ja-k-rya', hiragana: 'りゃ', katakana: 'リャ', romaji: 'rya',
    type: 'youon', row: 'り', column: 'ya', seionSource: null,
    exampleWord: 'りゃくご', exampleZh: '簡稱' },
  { id: 'ja-k-ryu', hiragana: 'りゅ', katakana: 'リュ', romaji: 'ryu',
    type: 'youon', row: 'り', column: 'yu', seionSource: null,
    exampleWord: 'りゅう', exampleZh: '龍' },
  { id: 'ja-k-ryo', hiragana: 'りょ', katakana: 'リョ', romaji: 'ryo',
    type: 'youon', row: 'り', column: 'yo', seionSource: null,
    exampleWord: 'りょこう', exampleZh: '旅行' },

  // ぎ行
  { id: 'ja-k-gya', hiragana: 'ぎゃ', katakana: 'ギャ', romaji: 'gya',
    type: 'youon', row: 'ぎ', column: 'ya', seionSource: null,
    exampleWord: 'ぎゃく', exampleZh: '相反' },
  { id: 'ja-k-gyu', hiragana: 'ぎゅ', katakana: 'ギュ', romaji: 'gyu',
    type: 'youon', row: 'ぎ', column: 'yu', seionSource: null,
    exampleWord: 'ぎゅうにゅう', exampleZh: '牛奶' },
  { id: 'ja-k-gyo', hiragana: 'ぎょ', katakana: 'ギョ', romaji: 'gyo',
    type: 'youon', row: 'ぎ', column: 'yo', seionSource: null,
    exampleWord: 'きんぎょ', exampleZh: '金魚' },

  // じ行
  { id: 'ja-k-ja', hiragana: 'じゃ', katakana: 'ジャ', romaji: 'ja',
    type: 'youon', row: 'じ', column: 'ya', seionSource: null,
    exampleWord: 'じゃがいも', exampleZh: '馬鈴薯' },
  { id: 'ja-k-ju', hiragana: 'じゅ', katakana: 'ジュ', romaji: 'ju',
    type: 'youon', row: 'じ', column: 'yu', seionSource: null,
    exampleWord: 'じゅぎょう', exampleZh: '上課' },
  { id: 'ja-k-jo', hiragana: 'じょ', katakana: 'ジョ', romaji: 'jo',
    type: 'youon', row: 'じ', column: 'yo', seionSource: null,
    exampleWord: 'じょせい', exampleZh: '女性' },

  // び行
  { id: 'ja-k-bya', hiragana: 'びゃ', katakana: 'ビャ', romaji: 'bya',
    type: 'youon', row: 'び', column: 'ya', seionSource: null,
    exampleWord: 'さんびゃく', exampleZh: '三百' },
  { id: 'ja-k-byu', hiragana: 'びゅ', katakana: 'ビュ', romaji: 'byu',
    type: 'youon', row: 'び', column: 'yu', seionSource: null,
    exampleWord: 'ビュッフェ', exampleZh: '自助餐' },
  { id: 'ja-k-byo', hiragana: 'びょ', katakana: 'ビョ', romaji: 'byo',
    type: 'youon', row: 'び', column: 'yo', seionSource: null,
    exampleWord: 'びょういん', exampleZh: '醫院' },

  // ぴ行
  { id: 'ja-k-pya', hiragana: 'ぴゃ', katakana: 'ピャ', romaji: 'pya',
    type: 'youon', row: 'ぴ', column: 'ya', seionSource: null,
    exampleWord: 'ろっぴゃく', exampleZh: '六百' },
  { id: 'ja-k-pyu', hiragana: 'ぴゅ', katakana: 'ピュ', romaji: 'pyu',
    type: 'youon', row: 'ぴ', column: 'yu', seionSource: null,
    exampleWord: 'コンピュータ', exampleZh: '電腦' },
  { id: 'ja-k-pyo', hiragana: 'ぴょ', katakana: 'ピョ', romaji: 'pyo',
    type: 'youon', row: 'ぴ', column: 'yo', seionSource: null,
    exampleWord: 'ぴょんぴょん', exampleZh: '蹦蹦跳跳' },
];
