/**
 * 英文單字題庫 · NGSL 第 8 批（詞頻排名 1401–1600）。
 *
 * 來源：New General Service List 1.2（Browne, Culligan & Phillips），CC BY-SA 4.0。
 * 詳細出處與授權見專案根目錄的 CREDITS.md。
 *
 * 整批歸「600–800 分」級（NGSL 詞頻 1201–2000 名）。
 *
 * 排除五個字：
 *   mouth / tea —— 已存在
 *   lawyer —— 與已收錄的 attorney 完全同義
 *   wed —— 與同批的 marry 完全同義
 *   till —— 與已收錄的 until 完全同義
 *
 * 近義字拉開中文，避免同一個題面對到兩個答案：
 *   oppose    對抗        ← 與 against 反對 區隔
 *   belong    隸屬        ← 與 of 屬於 區隔
 *   taste     嘗味道      ← 與 flavor 風味 區隔
 *   danger    險境        ← 與 hazard 危害 區隔
 *   anybody   隨便誰      ← 與 anyone 任何人 區隔
 *   manner    行事作風    ← 與 attitude 態度、behavior 行為舉止 區隔
 *   ignore    不予理會    ← 與 overlook 忽略 區隔
 *   acquire   習得        ← 與 obtain 取得 區隔
 *   fairly    還算        ← 與 quite 相當 區隔
 *   ought     理應        ← 與 should 應該 區隔
 *   proper    合乎規矩的  ← 與 appropriate 恰當的 區隔
 *   division  事業處      ← 與 department 部門、sector 部門別 區隔
 *   friendly  親切的      ← 與 nice 友善的 區隔
 *   plenty    豐足        ← 與 ample 充足的 區隔
 *   entirely  整個地      ← 與 completely 完全地、totally 全然 區隔
 *   guarantee 擔保        ← 與 warranty 保固、assurance 保證 區隔
 *   odd       反常的      ← 與 strange 奇怪的 區隔
 *   rely      倚重        ← 與 depend 依靠 區隔
 *   export    外銷        ← 與 exit 出口 區隔（測試抓出來的，中文同形不同義）
 */

/**
 * [中文, 英文, 詞性, 主題分類]，順序即 NGSL 詞頻排名
 */
const rows = [
  ['到…之上', 'onto', 'other', 'preposition'],
  ['歷史性的', 'historical', 'adjective', 'education'],
  ['對抗', 'oppose', 'verb', 'society'],
  ['分公司', 'branch', 'noun', 'business'],
  ['車輛', 'vehicle', 'noun', 'transport'],
  ['科學家', 'scientist', 'noun', 'education'],
  ['路線', 'route', 'noun', 'transport'],
  ['綁定', 'bind', 'verb', 'manufacturing'],
  ['隸屬', 'belong', 'verb', 'abstract'],
  ['嘗味道', 'taste', 'verb', 'food'],
  ['今晚', 'tonight', 'noun', 'time'],
  ['時尚', 'fashion', 'noun', 'clothing'],
  ['險境', 'danger', 'noun', 'society'],
  ['炸彈', 'bomb', 'noun', 'society'],
  ['陸軍', 'army', 'noun', 'society'],
  ['有危險性的', 'dangerous', 'adjective', 'quality'],
  ['減量', 'decrease', 'verb', 'quantity'],
  ['弄傷', 'hurt', 'verb', 'health'],
  ['議會', 'council', 'noun', 'society'],
  ['編輯', 'editor', 'noun', 'media'],
  ['通常來說', 'normally', 'adverb', 'time'],
  ['視野', 'sight', 'noun', 'body'],
  ['產生', 'generate', 'verb', 'tech'],
  ['禮物', 'gift', 'noun', 'entertainment'],
  ['送貨', 'delivery', 'noun', 'logistics'],
  ['否認', 'deny', 'verb', 'communication'],
  ['賓客', 'guest', 'noun', 'travel'],
  ['隨便誰', 'anybody', 'other', 'grammar'],
  ['臥室', 'bedroom', 'noun', 'house'],
  ['引述', 'quote', 'verb', 'communication'],
  ['攀爬', 'climb', 'verb', 'sport'],
  ['基本上', 'basically', 'adverb', 'grammar'],
  ['暴力', 'violence', 'noun', 'society'],
  ['部長', 'minister', 'noun', 'society'],
  ['主要地', 'mainly', 'adverb', 'quantity'],
  ['噪音', 'noise', 'noun', 'quality'],
  ['行事作風', 'manner', 'noun', 'emotion'],
  ['槍', 'gun', 'noun', 'society'],
  ['正方形', 'square', 'noun', 'quality'],
  ['場合', 'occasion', 'noun', 'entertainment'],
  ['熟悉的', 'familiar', 'adjective', 'education'],
  ['不予理會', 'ignore', 'verb', 'abstract'],
  ['摧毀', 'destroy', 'verb', 'society'],
  ['事務', 'affair', 'noun', 'business'],
  ['民間的', 'civil', 'adjective', 'society'],
  ['找出位置', 'locate', 'verb', 'place'],
  ['公民', 'citizen', 'noun', 'society'],
  ['溫度', 'temperature', 'noun', 'weather'],
  ['黃金', 'gold', 'noun', 'finance'],
  ['國內的', 'domestic', 'adjective', 'society'],
  ['裝載', 'load', 'verb', 'logistics'],
  ['信念', 'belief', 'noun', 'abstract'],
  ['部隊', 'troop', 'noun', 'society'],
  ['技術性的', 'technical', 'adjective', 'tech'],
  ['提醒', 'remind', 'verb', 'communication'],
  ['安排結果', 'arrangement', 'noun', 'office'],
  ['皮膚', 'skin', 'noun', 'body'],
  ['監獄', 'prison', 'noun', 'law'],
  ['切換', 'switch', 'verb', 'tech'],
  ['習得', 'acquire', 'verb', 'education'],
  ['企業的', 'corporate', 'adjective', 'business'],
  ['還算', 'fairly', 'adverb', 'quantity'],
  ['木材', 'wood', 'noun', 'manufacturing'],
  ['參與', 'participate', 'verb', 'society'],
  ['艱困的', 'tough', 'adjective', 'quality'],
  ['撕開', 'tear', 'verb', 'daily'],
  ['代表人員', 'representative', 'noun', 'business'],
  ['容量', 'capacity', 'noun', 'quantity'],
  ['邊界', 'border', 'noun', 'place'],
  ['搖動', 'shake', 'verb', 'movement'],
  ['評估', 'assessment', 'noun', 'business'],
  ['鞋子', 'shoe', 'noun', 'clothing'],
  ['理應', 'ought', 'other', 'modal'],
  ['廣告', 'ad', 'noun', 'marketing'],
  ['費用', 'fee', 'noun', 'finance'],
  ['大堂', 'hall', 'noun', 'realestate'],
  ['法規', 'regulation', 'noun', 'law'],
  ['逃脫', 'escape', 'verb', 'movement'],
  ['工作室', 'studio', 'noun', 'media'],
  ['合乎規矩的', 'proper', 'adjective', 'quality'],
  ['放鬆身心', 'relax', 'verb', 'emotion'],
  ['觀光客', 'tourist', 'noun', 'travel'],
  ['元件', 'component', 'noun', 'manufacturing'],
  ['負擔得起', 'afford', 'verb', 'finance'],
  ['懷疑對象', 'suspect', 'noun', 'law'],
  ['杯子', 'cup', 'noun', 'drink'],
  ['說明文字', 'description', 'noun', 'communication'],
  ['信心', 'confidence', 'noun', 'emotion'],
  ['工業的', 'industrial', 'adjective', 'manufacturing'],
  ['抱怨', 'complain', 'verb', 'communication'],
  ['視角', 'perspective', 'noun', 'abstract'],
  ['錯誤訊息', 'error', 'noun', 'tech'],
  ['逮捕', 'arrest', 'verb', 'law'],
  ['評定', 'assess', 'verb', 'business'],
  ['登記', 'register', 'verb', 'office'],
  ['資產', 'asset', 'noun', 'finance'],
  ['訊號', 'signal', 'noun', 'tech'],
  ['手指', 'finger', 'noun', 'body'],
  ['相關的', 'relevant', 'adjective', 'quality'],
  ['探索', 'explore', 'verb', 'travel'],
  ['領導力', 'leadership', 'noun', 'business'],
  ['承諾投入', 'commitment', 'noun', 'business'],
  ['醒來', 'wake', 'verb', 'daily'],
  ['必然', 'necessarily', 'adverb', 'grammar'],
  ['明亮的', 'bright', 'adjective', 'quality'],
  ['框架', 'frame', 'noun', 'manufacturing'],
  ['緩慢地', 'slowly', 'adverb', 'quality'],
  ['債券', 'bond', 'noun', 'finance'],
  ['招聘', 'hire', 'verb', 'hr'],
  ['洞', 'hole', 'noun', 'manufacturing'],
  ['領帶', 'tie', 'noun', 'clothing'],
  ['內部的', 'internal', 'adjective', 'business'],
  ['連鎖', 'chain', 'noun', 'marketing'],
  ['文學', 'literature', 'noun', 'education'],
  ['受害者', 'victim', 'noun', 'law'],
  ['威脅恫嚇', 'threaten', 'verb', 'society'],
  ['事業處', 'division', 'noun', 'business'],
  ['確保安全', 'secure', 'verb', 'society'],
  ['使驚嘆', 'amaze', 'verb', 'emotion'],
  ['裝置', 'device', 'noun', 'tech'],
  ['出生', 'birth', 'noun', 'family'],
  ['森林', 'forest', 'noun', 'nature'],
  ['標示', 'label', 'noun', 'marketing'],
  ['根部', 'root', 'noun', 'nature'],
  ['工廠', 'factory', 'noun', 'manufacturing'],
  ['開銷', 'expense', 'noun', 'finance'],
  ['頻道', 'channel', 'noun', 'media'],
  ['偵查', 'investigate', 'verb', 'law'],
  ['推薦建議', 'recommendation', 'noun', 'marketing'],
  ['排名', 'rank', 'noun', 'quantity'],
  ['典型的', 'typical', 'adjective', 'quality'],
  ['西方', 'west', 'noun', 'place'],
  ['親切的', 'friendly', 'adjective', 'emotion'],
  ['居民', 'resident', 'noun', 'realestate'],
  ['條款', 'provision', 'noun', 'law'],
  ['集中精神', 'concentrate', 'verb', 'abstract'],
  ['豐足', 'plenty', 'noun', 'quantity'],
  ['外銷', 'export', 'noun', 'logistics'],
  ['整個地', 'entirely', 'adverb', 'quantity'],
  ['強烈地', 'strongly', 'adverb', 'quantity'],
  ['橋', 'bridge', 'noun', 'transport'],
  ['由…組成', 'consist', 'verb', 'abstract'],
  ['畢業生', 'graduate', 'noun', 'education'],
  ['品牌', 'brand', 'noun', 'marketing'],
  ['道德的', 'moral', 'adjective', 'society'],
  ['堅持', 'insist', 'verb', 'communication'],
  ['組合', 'combination', 'noun', 'abstract'],
  ['濫用', 'abuse', 'noun', 'law'],
  ['冰', 'ice', 'noun', 'nature'],
  ['校長', 'principal', 'noun', 'education'],
  ['精通', 'master', 'verb', 'education'],
  ['肯定地', 'definitely', 'adverb', 'grammar'],
  ['場次', 'session', 'noun', 'education'],
  ['成績', 'grade', 'noun', 'education'],
  ['儘管如此', 'nevertheless', 'other', 'conjunction'],
  ['預測未來', 'predict', 'verb', 'abstract'],
  ['先前地', 'previously', 'adverb', 'time'],
  ['保護措施', 'protection', 'noun', 'society'],
  ['大部分是', 'largely', 'adverb', 'quantity'],
  ['租金', 'rent', 'noun', 'realestate'],
  ['射擊', 'shot', 'noun', 'sport'],
  ['外觀', 'appearance', 'noun', 'quality'],
  ['合理的', 'reasonable', 'adjective', 'quality'],
  ['擔保', 'guarantee', 'noun', 'business'],
  ['主軸', 'theme', 'noun', 'abstract'],
  ['判斷', 'judgment', 'noun', 'abstract'],
  ['反常的', 'odd', 'adjective', 'quality'],
  ['核准', 'approve', 'verb', 'business'],
  ['貸款', 'loan', 'noun', 'finance'],
  ['定義內容', 'definition', 'noun', 'education'],
  ['選出', 'elect', 'verb', 'society'],
  ['氛圍', 'atmosphere', 'noun', 'emotion'],
  ['農夫', 'farmer', 'noun', 'nature'],
  ['比較結果', 'comparison', 'noun', 'abstract'],
  ['特徵', 'characteristic', 'noun', 'abstract'],
  ['執照', 'license', 'noun', 'law'],
  ['倚重', 'rely', 'verb', 'abstract'],
  ['狹窄的', 'narrow', 'adjective', 'quality'],
  ['成功達成', 'succeed', 'verb', 'business'],
  ['身分', 'identity', 'noun', 'society'],
  ['書桌', 'desk', 'noun', 'office'],
  ['許可證', 'permit', 'noun', 'law'],
  ['認真地', 'seriously', 'adverb', 'emotion'],
  ['野生的', 'wild', 'adjective', 'nature'],
  ['空的', 'empty', 'adjective', 'quantity'],
  ['佣金', 'commission', 'noun', 'finance'],
  ['獨一無二的', 'unique', 'adjective', 'quality'],
  ['協會', 'association', 'noun', 'society'],
  ['樂器', 'instrument', 'noun', 'entertainment'],
  ['投資人', 'investor', 'noun', 'finance'],
  ['實用的', 'practical', 'adjective', 'quality'],
  ['可愛的', 'lovely', 'adjective', 'emotion'],
  ['柔軟的', 'soft', 'adjective', 'quality'],
  ['排', 'row', 'noun', 'quantity'],
  ['青春', 'youth', 'noun', 'time'],
];

/**
 * 這一批的難度：NGSL 詞頻 1201–2000 名歸「600–800 分」
 */
const LEVEL = 3;

/**
 * 這一批的起始流水號，接在 ngsl-07.js 的 en-w-2667 之後
 */
const START = 2668;

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
