/**
 * 英文單字題庫 · NGSL 第 9 批（詞頻排名 1601–1800）。
 *
 * 來源：New General Service List 1.2（Browne, Culligan & Phillips），CC BY-SA 4.0。
 * 詳細出處與授權見專案根目錄的 CREDITS.md。
 *
 * 整批歸「600–800 分」級（NGSL 詞頻 1201–2000 名）。
 *
 * 排除六個字：
 *   ear / cat / milk —— 已存在
 *   dad —— 與 core.js 的 father 同義
 *   chairman —— 與已收錄的 chairperson 只差性別詞尾
 *   meanwhile —— 與已收錄的 meantime 完全同義
 *
 * 近義字拉開中文，避免同一個題面對到兩個答案：
 *   sheet       床單        ← 與 paper 紙 區隔
 *   journey     歷程        ← 與 trip 旅程、travel 旅行 區隔
 *   suitable    相稱的      ← 與 appropriate 恰當的、fit 適合 區隔
 *   passenger   乘車旅客    ← 與 traveler 旅客、rider 乘客 區隔
 *   phase       進程        ← 與 stage 階段 區隔
 *   ill         不適的      ← 與 sick 生病的 區隔
 *   besides     另外還有    ← 與 except 除了…之外 區隔
 *   chart       走勢圖      ← 與 graph 圖表 區隔
 *   furthermore 更有甚者    ← 與 moreover 再者 區隔
 *   medicine    醫學        ← 與 medication 藥物 區隔
 *   shut        闔上        ← 與 close 關閉 區隔
 *   critic      批評家      ← 與 reviewer 評論者 區隔
 *   enormous    碩大無比的  ← 與 huge 龐大的 區隔
 *   pilot       飛行員      ← 與 captain 機長 區隔
 *   merely      不過是      ← 與 only 只有 區隔
 *   communicate 交流        ← 與 communication 溝通 區隔
 */

/**
 * [中文, 英文, 詞性, 主題分類]，順序即 NGSL 詞頻排名
 */
const rows = [
  ['鎖', 'lock', 'noun', 'house'],
  ['燃料', 'fuel', 'noun', 'transport'],
  ['期望', 'expectation', 'noun', 'abstract'],
  ['就業', 'employment', 'noun', 'hr'],
  ['慶祝', 'celebrate', 'verb', 'entertainment'],
  ['性方面的', 'sexual', 'adjective', 'society'],
  ['肩膀', 'shoulder', 'noun', 'body'],
  ['呼吸', 'breath', 'noun', 'body'],
  ['日益地', 'increasingly', 'adverb', 'quantity'],
  ['進口', 'import', 'noun', 'logistics'],
  ['瓶子', 'bottle', 'noun', 'drink'],
  ['我們自己', 'ourselves', 'other', 'pronoun'],
  ['床單', 'sheet', 'noun', 'house'],
  ['引擎', 'engine', 'noun', 'transport'],
  ['演員陣容', 'cast', 'noun', 'entertainment'],
  ['想法', 'notion', 'noun', 'abstract'],
  ['保守的', 'conservative', 'adjective', 'society'],
  ['歷程', 'journey', 'noun', 'travel'],
  ['反對陣營', 'opposition', 'noun', 'society'],
  ['寬慰', 'relief', 'noun', 'emotion'],
  ['債務', 'debt', 'noun', 'finance'],
  ['榮譽', 'honor', 'noun', 'society'],
  ['結果成效', 'outcome', 'noun', 'abstract'],
  ['責怪', 'blame', 'verb', 'communication'],
  ['解說', 'explanation', 'noun', 'communication'],
  ['產生出現', 'arise', 'verb', 'abstract'],
  ['音樂劇', 'musical', 'noun', 'entertainment'],
  ['復原', 'recover', 'verb', 'health'],
  ['伸展', 'stretch', 'verb', 'sport'],
  ['申報', 'declare', 'verb', 'law'],
  ['退休', 'retire', 'verb', 'hr'],
  ['微小的', 'tiny', 'adjective', 'quantity'],
  ['小心的', 'careful', 'adjective', 'quality'],
  ['相稱的', 'suitable', 'adjective', 'quality'],
  ['母語的', 'native', 'adjective', 'education'],
  ['水果', 'fruit', 'noun', 'food'],
  ['分析研判', 'analyze', 'verb', 'abstract'],
  ['目擊者', 'witness', 'noun', 'law'],
  ['郵件', 'mail', 'noun', 'communication'],
  ['糟糕的', 'terrible', 'adjective', 'quality'],
  ['研究員', 'researcher', 'noun', 'education'],
  ['平凡的', 'ordinary', 'adjective', 'quality'],
  ['精選', 'selection', 'noun', 'marketing'],
  ['任何地方', 'anywhere', 'other', 'place'],
  ['心理的', 'mental', 'adjective', 'health'],
  ['參與者', 'participant', 'noun', 'society'],
  ['願景', 'vision', 'noun', 'business'],
  ['人格特質', 'personality', 'noun', 'abstract'],
  ['具體來說', 'specifically', 'adverb', 'grammar'],
  ['脂肪', 'fat', 'noun', 'health'],
  ['進入資格', 'entry', 'noun', 'travel'],
  ['同伴', 'fellow', 'noun', 'society'],
  ['化學物質', 'chemical', 'noun', 'manufacturing'],
  ['捕捉', 'capture', 'verb', 'media'],
  ['小費', 'tip', 'noun', 'dining'],
  ['折扣', 'discount', 'noun', 'marketing'],
  ['高峰', 'peak', 'noun', 'quantity'],
  ['比例', 'proportion', 'noun', 'quantity'],
  ['消失', 'disappear', 'verb', 'abstract'],
  ['大喊', 'shout', 'verb', 'communication'],
  ['院子', 'yard', 'noun', 'house'],
  ['持續不變的', 'constant', 'adjective', 'time'],
  ['顯著地', 'significantly', 'adverb', 'quantity'],
  ['丘陵', 'hill', 'noun', 'nature'],
  ['相當大的', 'considerable', 'adjective', 'quantity'],
  ['指示說明', 'instruction', 'noun', 'communication'],
  ['智力', 'intelligence', 'noun', 'abstract'],
  ['理想的', 'ideal', 'adjective', 'quality'],
  ['民間人士', 'folk', 'noun', 'society'],
  ['想必', 'surely', 'adverb', 'grammar'],
  ['警衛', 'guard', 'noun', 'society'],
  ['有幾分', 'somewhat', 'adverb', 'quantity'],
  ['親吻', 'kiss', 'verb', 'emotion'],
  ['簡報', 'presentation', 'noun', 'business'],
  ['共同的', 'joint', 'adjective', 'business'],
  ['競爭', 'compete', 'verb', 'sport'],
  ['民調', 'poll', 'noun', 'society'],
  ['虛弱的', 'weak', 'adjective', 'quality'],
  ['信仰', 'faith', 'noun', 'society'],
  ['削減幅度', 'reduction', 'noun', 'quantity'],
  ['預留', 'reserve', 'verb', 'travel'],
  ['客訴', 'complaint', 'noun', 'communication'],
  ['使厭煩', 'bore', 'verb', 'emotion'],
  ['任務使命', 'mission', 'noun', 'business'],
  ['不知怎地', 'somehow', 'adverb', 'grammar'],
  ['語氣', 'tone', 'noun', 'communication'],
  ['鄰里', 'neighborhood', 'noun', 'place'],
  ['乘車旅客', 'passenger', 'noun', 'transport'],
  ['司法', 'justice', 'noun', 'law'],
  ['進程', 'phase', 'noun', 'time'],
  ['薄的', 'thin', 'adjective', 'quality'],
  ['趕忙', 'rush', 'verb', 'movement'],
  ['正式的', 'formal', 'adjective', 'communication'],
  ['宗教', 'religion', 'noun', 'society'],
  ['雇主', 'employer', 'noun', 'hr'],
  ['駁回', 'reject', 'verb', 'business'],
  ['後者', 'latter', 'noun', 'quantity'],
  ['盤子', 'plate', 'noun', 'dining'],
  ['禁令', 'ban', 'noun', 'law'],
  ['偷竊', 'steal', 'verb', 'law'],
  ['抗議', 'protest', 'noun', 'society'],
  ['索引', 'index', 'noun', 'media'],
  ['難過的', 'sad', 'adjective', 'emotion'],
  ['頻繁地', 'frequently', 'adverb', 'time'],
  ['圓圈', 'circle', 'noun', 'quality'],
  ['有幫助的', 'helpful', 'adjective', 'quality'],
  ['指令', 'command', 'noun', 'tech'],
  ['有吸引力的', 'attractive', 'adjective', 'marketing'],
  ['生病的', 'sick', 'adjective', 'health'],
  ['印象', 'impression', 'noun', 'emotion'],
  ['無法做到的', 'unable', 'adjective', 'quality'],
  ['笑話', 'joke', 'noun', 'entertainment'],
  ['天空', 'sky', 'noun', 'nature'],
  ['專欄', 'column', 'noun', 'media'],
  ['電子的', 'electronic', 'adjective', 'tech'],
  ['強加', 'impose', 'verb', 'law'],
  ['罪犯', 'criminal', 'noun', 'law'],
  ['另外還有', 'besides', 'other', 'conjunction'],
  ['妥當地', 'properly', 'adverb', 'quality'],
  ['古代的', 'ancient', 'adjective', 'time'],
  ['海岸', 'coast', 'noun', 'nature'],
  ['不適的', 'ill', 'adjective', 'health'],
  ['踢', 'kick', 'verb', 'sport'],
  ['密切地', 'closely', 'adverb', 'quantity'],
  ['多重的', 'multiple', 'adjective', 'quantity'],
  ['產出', 'yield', 'noun', 'manufacturing'],
  ['經由', 'via', 'other', 'preposition'],
  ['立法', 'legislation', 'noun', 'law'],
  ['郡縣', 'county', 'noun', 'place'],
  ['不同於', 'unlike', 'other', 'preposition'],
  ['行動式的', 'mobile', 'adjective', 'tech'],
  ['助理', 'assistant', 'noun', 'hr'],
  ['實施', 'implement', 'verb', 'business'],
  ['走勢圖', 'chart', 'noun', 'media'],
  ['附加', 'attach', 'verb', 'communication'],
  ['地獄', 'hell', 'noun', 'society'],
  ['到處', 'everywhere', 'other', 'place'],
  ['提供建議', 'advise', 'verb', 'communication'],
  ['家戶', 'household', 'noun', 'house'],
  ['認可', 'acknowledge', 'verb', 'communication'],
  ['獎勵', 'reward', 'noun', 'hr'],
  ['東方', 'east', 'noun', 'place'],
  ['帽子', 'hat', 'noun', 'clothing'],
  ['學術的', 'academic', 'adjective', 'education'],
  ['選民', 'voter', 'noun', 'society'],
  ['更有甚者', 'furthermore', 'other', 'conjunction'],
  ['指控', 'accuse', 'verb', 'law'],
  ['科學的', 'scientific', 'adjective', 'education'],
  ['工資', 'wage', 'noun', 'finance'],
  ['缺席', 'absence', 'noun', 'hr'],
  ['建構', 'construct', 'verb', 'realestate'],
  ['評語', 'remark', 'noun', 'communication'],
  ['醫學', 'medicine', 'noun', 'health'],
  ['教授', 'professor', 'noun', 'education'],
  ['罕見的', 'rare', 'adjective', 'quantity'],
  ['意圖', 'intention', 'noun', 'abstract'],
  ['一打', 'dozen', 'noun', 'quantity'],
  ['和解', 'settlement', 'noun', 'law'],
  ['落差', 'gap', 'noun', 'quantity'],
  ['廣泛地', 'widely', 'adverb', 'quantity'],
  ['最低限度', 'minimum', 'noun', 'quantity'],
  ['北部的', 'northern', 'adjective', 'place'],
  ['地產', 'estate', 'noun', 'realestate'],
  ['同等地', 'equally', 'adverb', 'quantity'],
  ['暴露', 'expose', 'verb', 'media'],
  ['活著的', 'alive', 'adjective', 'health'],
  ['闔上', 'shut', 'verb', 'daily'],
  ['勝利', 'victory', 'noun', 'sport'],
  ['化解', 'resolve', 'verb', 'abstract'],
  ['批評家', 'critic', 'noun', 'media'],
  ['變數', 'variable', 'noun', 'tech'],
  ['碩大無比的', 'enormous', 'adjective', 'quantity'],
  ['甜的', 'sweet', 'adjective', 'food'],
  ['永久的', 'permanent', 'adjective', 'time'],
  ['情緒', 'emotion', 'noun', 'emotion'],
  ['追求', 'pursue', 'verb', 'abstract'],
  ['高大的', 'tall', 'adjective', 'quality'],
  ['力勸', 'urge', 'verb', 'communication'],
  ['敵人', 'enemy', 'noun', 'society'],
  ['任命', 'appoint', 'verb', 'hr'],
  ['才能', 'talent', 'noun', 'hr'],
  ['氣味', 'smell', 'noun', 'body'],
  ['事前的', 'prior', 'adjective', 'time'],
  ['優先順序', 'priority', 'noun', 'business'],
  ['線上的', 'online', 'adjective', 'tech'],
  ['片語', 'phrase', 'noun', 'education'],
  ['飛行員', 'pilot', 'noun', 'travel'],
  ['穩定的', 'stable', 'adjective', 'quality'],
  ['不過是', 'merely', 'adverb', 'quantity'],
  ['決議', 'resolution', 'noun', 'business'],
  ['交流', 'communicate', 'verb', 'communication'],
  ['傷勢', 'injury', 'noun', 'health'],
  ['廣大的', 'vast', 'adjective', 'quantity'],
  ['展覽', 'exhibition', 'noun', 'entertainment'],
];

/**
 * 這一批的難度：NGSL 詞頻 1201–2000 名歸「600–800 分」
 */
const LEVEL = 3;

/**
 * 這一批的起始流水號，接在 ngsl-08.js 的 en-w-2862 之後
 */
const START = 2863;

export const words = rows.map(([zh, target, pos, category], i) => ({
  id: `en-w-${String(START + i).padStart(3, '0')}`,
  zh,
  target,
  reading: null,
  romaji: null,
  pos,
  category,
  level: LEVEL,
}));
