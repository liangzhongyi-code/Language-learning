/**
 * 英文單字題庫 · NGSL 第 11 批（詞頻排名 2001–2200）。
 *
 * 來源：New General Service List 1.2（Browne, Culligan & Phillips），CC BY-SA 4.0。
 * 詳細出處與授權見專案根目錄的 CREDITS.md。
 *
 * 整批歸「800–990 分」級（NGSL 詞頻 2001–2801 名）。
 *
 * 排除六個字：
 *   beer / cloud / nose / cake —— 已存在
 *   mom —— 與 core.js 的 mother 同義
 *   adviser —— 與已收錄的 advisor 只是拼法不同
 *
 * 近義字拉開中文，避免同一個題面對到兩個答案：
 *   supplier     供貨商      ← 與 provider 供應商 區隔
 *   acquisition  收購行動    ← 與 merger 併購 區隔
 *   recognition  表揚肯定    ← 與 acknowledge 認可 區隔
 *   electricity  電流        ← 與 power 電力 區隔
 *   respectively 依序各為    ← 與 separately 分別地 區隔
 *   ultimately   歸根究柢    ← 與 eventually 最終地 區隔
 *   undertake    承辦        ← 與 commit 承擔 區隔
 *   wire         金屬線      ← 與 cord 電線 區隔
 *   framework    整體架構    ← 與 frame 框架、structure 結構 區隔
 *   assure       掛保證      ← 與 ensure 確保、guarantee 擔保 區隔
 *   virtually    實質上      ← 與 almost 幾乎 區隔
 *   recruit      延攬        ← 與 hire 招聘 區隔
 *   persuade     說動        ← 與 convince 說服 區隔
 *   hence        由此        ← 與 therefore 故而、thus 因而 區隔
 *   assist       從旁幫忙    ← 與 help 幫助 區隔
 *   steady       不搖晃的    ← 與 stable 穩定的 區隔
 *   sir          長官        ← 與 mister 先生 區隔
 *   evaluate     審核評價    ← 與 assess 評定 區隔
 *   pub          英式酒館    ← 與 bar 酒吧 區隔
 *   rarely       難得        ← 與 seldom 很少 區隔
 *   everyday     稀鬆平常的  ← 與 daily 每日的 區隔
 *   apartment    出租公寓    ← 與 condominium 公寓大樓 區隔
 *   trail        山徑        ← 與 path 路徑 區隔
 *   remarkable   非凡的      ← 與 terrific 了不起的 區隔
 *   frighten     嚇壞        ← 與 scare 使害怕 區隔
 *   stem         起於        ← 與 derive 衍生自 區隔
 */

/**
 * [中文, 英文, 詞性, 主題分類]，順序即 NGSL 詞頻排名
 */
const rows = [
  ['供貨商', 'supplier', 'noun', 'logistics'],
  ['獎品', 'prize', 'noun', 'entertainment'],
  ['一般而言', 'typically', 'adverb', 'quality'],
  ['同儕', 'peer', 'noun', 'society'],
  ['退休金', 'pension', 'noun', 'finance'],
  ['翅膀', 'wing', 'noun', 'animal'],
  ['收購行動', 'acquisition', 'noun', 'business'],
  ['笑聲', 'laughter', 'noun', 'emotion'],
  ['深深地', 'deeply', 'adverb', 'quantity'],
  ['表揚肯定', 'recognition', 'noun', 'society'],
  ['電流', 'electricity', 'noun', 'tech'],
  ['協助', 'assistance', 'noun', 'hr'],
  ['屋頂', 'roof', 'noun', 'realestate'],
  ['退休生活', 'retirement', 'noun', 'hr'],
  ['依序各為', 'respectively', 'adverb', 'quantity'],
  ['變化型', 'variation', 'noun', 'quantity'],
  ['歸根究柢', 'ultimately', 'adverb', 'time'],
  ['證明文件', 'proof', 'noun', 'law'],
  ['土壤', 'soil', 'noun', 'nature'],
  ['聰明的', 'smart', 'adjective', 'quality'],
  ['層次', 'layer', 'noun', 'manufacturing'],
  ['使不悅', 'upset', 'verb', 'emotion'],
  ['牙齒', 'tooth', 'noun', 'body'],
  ['代表性', 'representation', 'noun', 'business'],
  ['籌備', 'preparation', 'noun', 'business'],
  ['爭議', 'dispute', 'noun', 'law'],
  ['議程', 'agenda', 'noun', 'office'],
  ['重點強調', 'emphasis', 'noun', 'communication'],
  ['版次', 'edition', 'noun', 'media'],
  ['銀', 'silver', 'noun', 'finance'],
  ['娛樂', 'entertainment', 'noun', 'entertainment'],
  ['誠實的', 'honest', 'adjective', 'emotion'],
  ['承辦', 'undertake', 'verb', 'business'],
  ['零售', 'retail', 'noun', 'marketing'],
  ['金屬線', 'wire', 'noun', 'manufacturing'],
  ['不太可能的', 'unlikely', 'adjective', 'quality'],
  ['同志的', 'gay', 'adjective', 'society'],
  ['出版品', 'publication', 'noun', 'media'],
  ['輕微的', 'slight', 'adjective', 'quantity'],
  ['未知的', 'unknown', 'adjective', 'quality'],
  ['整體架構', 'framework', 'noun', 'tech'],
  ['區塊', 'zone', 'noun', 'place'],
  ['限縮', 'restrict', 'verb', 'law'],
  ['追溯', 'trace', 'verb', 'abstract'],
  ['英吋', 'inch', 'noun', 'quantity'],
  ['等同的', 'equivalent', 'adjective', 'quantity'],
  ['堅實的', 'solid', 'adjective', 'quality'],
  ['企業體', 'enterprise', 'noun', 'business'],
  ['年長的', 'elderly', 'adjective', 'society'],
  ['積欠', 'owe', 'verb', 'finance'],
  ['州長', 'governor', 'noun', 'society'],
  ['制服', 'uniform', 'noun', 'clothing'],
  ['港口', 'port', 'noun', 'logistics'],
  ['推銷簡報', 'pitch', 'noun', 'marketing'],
  ['抵達時刻', 'arrival', 'noun', 'travel'],
  ['當代的', 'contemporary', 'adjective', 'time'],
  ['登機門', 'gate', 'noun', 'travel'],
  ['減輕', 'ease', 'verb', 'health'],
  ['專科人員', 'specialist', 'noun', 'education'],
  ['掛保證', 'assure', 'verb', 'communication'],
  ['個人檔案', 'profile', 'noun', 'tech'],
  ['心情', 'mood', 'noun', 'emotion'],
  ['集數', 'episode', 'noun', 'media'],
  ['裂縫', 'crack', 'noun', 'manufacturing'],
  ['為數眾多的', 'numerous', 'adjective', 'quantity'],
  ['提交', 'submit', 'verb', 'office'],
  ['症狀', 'symptom', 'noun', 'health'],
  ['實質上', 'virtually', 'adverb', 'quantity'],
  ['年代', 'era', 'noun', 'time'],
  ['涵蓋範圍', 'coverage', 'noun', 'media'],
  ['緊張關係', 'tension', 'noun', 'emotion'],
  ['纜線', 'cable', 'noun', 'tech'],
  ['敏感的', 'sensitive', 'adjective', 'emotion'],
  ['緊張的', 'nervous', 'adjective', 'emotion'],
  ['輸入', 'input', 'noun', 'tech'],
  ['隔離', 'isolate', 'verb', 'health'],
  ['囚犯', 'prisoner', 'noun', 'law'],
  ['消除', 'eliminate', 'verb', 'abstract'],
  ['緊的', 'tight', 'adjective', 'quality'],
  ['潮濕的', 'wet', 'adjective', 'weather'],
  ['次級的', 'secondary', 'adjective', 'education'],
  ['福利', 'welfare', 'noun', 'society'],
  ['延攬', 'recruit', 'verb', 'hr'],
  ['排除', 'exclude', 'verb', 'quantity'],
  ['字串', 'string', 'noun', 'tech'],
  ['說動', 'persuade', 'verb', 'communication'],
  ['啟發', 'inspire', 'verb', 'emotion'],
  ['宏大的', 'grand', 'adjective', 'quality'],
  ['由此', 'hence', 'other', 'conjunction'],
  ['機組人員', 'crew', 'noun', 'travel'],
  ['現象', 'phenomenon', 'noun', 'abstract'],
  ['學童', 'pupil', 'noun', 'education'],
  ['錯誤不實的', 'false', 'adjective', 'quality'],
  ['從旁幫忙', 'assist', 'verb', 'hr'],
  ['修復', 'restore', 'verb', 'manufacturing'],
  ['公式', 'formula', 'noun', 'education'],
  ['更動', 'alter', 'verb', 'abstract'],
  ['感知', 'perceive', 'verb', 'abstract'],
  ['例行程序', 'routine', 'noun', 'daily'],
  ['水槽', 'sink', 'noun', 'house'],
  ['凝視', 'stare', 'verb', 'body'],
  ['不再', 'anymore', 'adverb', 'time'],
  ['英雄', 'hero', 'noun', 'entertainment'],
  ['支持者', 'supporter', 'noun', 'society'],
  ['轉換', 'convert', 'verb', 'tech'],
  ['不搖晃的', 'steady', 'adjective', 'quality'],
  ['公尺', 'meter', 'noun', 'quantity'],
  ['卡車', 'truck', 'noun', 'transport'],
  ['在…旁邊', 'beside', 'other', 'preposition'],
  ['航行', 'sail', 'verb', 'travel'],
  ['災難', 'disaster', 'noun', 'society'],
  ['步調', 'pace', 'noun', 'quantity'],
  ['大量地', 'heavily', 'adverb', 'quantity'],
  ['投注心力', 'devote', 'verb', 'emotion'],
  ['恐怖分子', 'terrorist', 'noun', 'society'],
  ['正當化', 'justify', 'verb', 'law'],
  ['攸關生死的', 'vital', 'adjective', 'quality'],
  ['使著迷', 'fascinate', 'verb', 'emotion'],
  ['外部的', 'external', 'adjective', 'business'],
  ['備用的', 'spare', 'adjective', 'manufacturing'],
  ['每當', 'whenever', 'other', 'conjunction'],
  ['憂鬱', 'depression', 'noun', 'health'],
  ['有罪的', 'guilty', 'adjective', 'law'],
  ['構成基礎', 'underlie', 'verb', 'abstract'],
  ['區別', 'distinction', 'noun', 'abstract'],
  ['滿意度', 'satisfaction', 'noun', 'emotion'],
  ['納入', 'incorporate', 'verb', 'business'],
  ['倒出', 'pour', 'verb', 'daily'],
  ['掃地', 'sweep', 'verb', 'daily'],
  ['義務', 'obligation', 'noun', 'law'],
  ['長官', 'sir', 'noun', 'communication'],
  ['審核評價', 'evaluate', 'verb', 'business'],
  ['憤怒', 'anger', 'noun', 'emotion'],
  ['英式酒館', 'pub', 'noun', 'dining'],
  ['觀感', 'perception', 'noun', 'abstract'],
  ['自然而然地', 'naturally', 'adverb', 'grammar'],
  ['貨幣', 'currency', 'noun', 'finance'],
  ['資料庫', 'database', 'noun', 'tech'],
  ['起初', 'initially', 'adverb', 'time'],
  ['領土', 'territory', 'noun', 'place'],
  ['溪流', 'stream', 'noun', 'nature'],
  ['難得', 'rarely', 'adverb', 'quantity'],
  ['高度', 'height', 'noun', 'quantity'],
  ['顯而易見的', 'apparent', 'adjective', 'quality'],
  ['西部的', 'western', 'adjective', 'place'],
  ['擴張規模', 'expansion', 'noun', 'quantity'],
  ['不斷地', 'constantly', 'adverb', 'time'],
  ['肌肉', 'muscle', 'noun', 'body'],
  ['使害怕', 'scare', 'verb', 'emotion'],
  ['糟糕地', 'badly', 'adverb', 'quality'],
  ['稀鬆平常的', 'everyday', 'adjective', 'daily'],
  ['界線', 'boundary', 'noun', 'place'],
  ['比率', 'ratio', 'noun', 'quantity'],
  ['論說文', 'essay', 'noun', 'education'],
  ['尖叫', 'scream', 'verb', 'emotion'],
  ['撤回', 'withdraw', 'verb', 'business'],
  ['污染問題', 'pollution', 'noun', 'nature'],
  ['失調', 'disorder', 'noun', 'health'],
  ['家具', 'furniture', 'noun', 'house'],
  ['符號', 'symbol', 'noun', 'abstract'],
  ['出租公寓', 'apartment', 'noun', 'realestate'],
  ['示威', 'demonstration', 'noun', 'society'],
  ['分析師', 'analyst', 'noun', 'finance'],
  ['月台', 'platform', 'noun', 'transport'],
  ['鋼鐵', 'steel', 'noun', 'manufacturing'],
  ['徹底轉變', 'transform', 'verb', 'abstract'],
  ['傷口', 'wound', 'noun', 'health'],
  ['限制條件', 'restriction', 'noun', 'law'],
  ['基金會', 'foundation', 'noun', 'society'],
  ['設計師', 'designer', 'noun', 'marketing'],
  ['拉傷', 'strain', 'noun', 'health'],
  ['創新', 'innovation', 'noun', 'business'],
  ['專輯', 'album', 'noun', 'entertainment'],
  ['歌手', 'singer', 'noun', 'entertainment'],
  ['山徑', 'trail', 'noun', 'travel'],
  ['陷阱', 'trap', 'noun', 'society'],
  ['鬆脫的', 'loose', 'adjective', 'quality'],
  ['延伸段', 'extension', 'noun', 'tech'],
  ['財富', 'wealth', 'noun', 'finance'],
  ['逐漸地', 'gradually', 'adverb', 'time'],
  ['儲槽', 'tank', 'noun', 'manufacturing'],
  ['邪惡的', 'evil', 'adjective', 'society'],
  ['非凡的', 'remarkable', 'adjective', 'quality'],
  ['曲調', 'tune', 'noun', 'entertainment'],
  ['草', 'grass', 'noun', 'nature'],
  ['邀請函', 'invitation', 'noun', 'communication'],
  ['過渡', 'transition', 'noun', 'time'],
  ['嚇壞', 'frighten', 'verb', 'emotion'],
  ['投標', 'bid', 'noun', 'business'],
  ['繁殖', 'breed', 'verb', 'animal'],
  ['超乎尋常的', 'extraordinary', 'adjective', 'quality'],
  ['才華洋溢的', 'brilliant', 'adjective', 'quality'],
  ['起於', 'stem', 'verb', 'abstract'],
  ['逆轉', 'reverse', 'verb', 'abstract'],
];

/**
 * 這一批的難度：NGSL 詞頻 2001–2801 名歸「800–990 分」
 */
const LEVEL = 4;

/**
 * 這一批的起始流水號，接在 ngsl-10.js 的 en-w-3248 之後
 */
const START = 3249;

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
