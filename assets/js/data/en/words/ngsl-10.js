/**
 * 英文單字題庫 · NGSL 第 10 批（詞頻排名 1801–2000）。
 *
 * 來源：New General Service List 1.2（Browne, Culligan & Phillips），CC BY-SA 4.0。
 * 詳細出處與授權見專案根目錄的 CREDITS.md。
 *
 * 整批歸「600–800 分」級。NGSL 詞頻 1201–2000 名這一段到此收完。
 *
 * 排除七個字：
 *   yellow / tennis / snow —— 已存在
 *   journalist —— 與同批的 reporter 完全同義
 *   advertisement —— 已收錄的 ad 就是它的縮寫
 *   criterion —— 已收錄的 criteria 是它的複數
 *   bike —— 與 core.js 的 bicycle 完全同義
 *
 * 近義字拉開中文，避免同一個題面對到兩個答案：
 *   incident     突發事件    ← 與 accident 意外事故 區隔
 *   accompany    隨行        ← 與 escort 陪同 區隔
 *   prime        最佳的      ← 與 primary 初級的、main 首要的 區隔
 *   forth        往外        ← 與 forward 向前 區隔
 *   repair       修繕        ← 與 fix 修理 區隔
 *   fundamental  基礎性的    ← 與 basic 基本的 區隔
 *   defeat       敗仗        ← 與 beat 擊敗 區隔
 *   enhance      增進        ← 與 improve 改善、reinforce 強化 區隔
 *   breathe      吸吐        ← 與 breath 呼吸 區隔
 *   partly       有一部分    ← 與 partially 部分地 區隔
 *   output       輸出量      ← 與 yield 產出 區隔
 *   install      裝設        ← 與 installation 安裝 區隔
 *   sufficient   足量的      ← 與 enough 足夠的、ample 充足的 區隔
 *   abandon      棄置        ← 與 waive 放棄權利 區隔
 *   rapidly      急速地      ← 與 quickly 迅速地 區隔
 *   efficient    講求效率的  ← 與 efficiently 有效率地 區隔
 *   premise      立論基礎    ← 與 assumption 假設前提 區隔
 *   landscape    地貌        ← 與 scenery 風景 區隔
 *   exhibit      陳展        ← 與 exhibition 展覽 區隔
 *   achievement  功績        ← 與 accomplishment 成就 區隔
 *   shoot        拍攝        ← 與 shot 射擊 區隔
 */

/**
 * [中文, 英文, 詞性, 主題分類]，順序即 NGSL 詞頻排名
 */
const rows = [
  ['製作人', 'producer', 'noun', 'media'],
  ['區域性的', 'regional', 'adjective', 'place'],
  ['立即的', 'immediate', 'adjective', 'time'],
  ['突發事件', 'incident', 'noun', 'society'],
  ['童年', 'childhood', 'noun', 'time'],
  ['草稿', 'draft', 'noun', 'office'],
  ['滑倒', 'slip', 'verb', 'movement'],
  ['隨行', 'accompany', 'verb', 'emotion'],
  ['政治人物', 'politician', 'noun', 'society'],
  ['生氣的', 'angry', 'adjective', 'emotion'],
  ['敲門', 'knock', 'verb', 'movement'],
  ['種子', 'seed', 'noun', 'nature'],
  ['薪水', 'salary', 'noun', 'finance'],
  ['舉例說明', 'illustrate', 'verb', 'communication'],
  ['暗示', 'imply', 'verb', 'communication'],
  ['早餐', 'breakfast', 'noun', 'dining'],
  ['臨時的', 'temporary', 'adjective', 'time'],
  ['開明的', 'liberal', 'adjective', 'society'],
  ['湖泊', 'lake', 'noun', 'nature'],
  ['取得資格', 'qualify', 'verb', 'hr'],
  ['有競爭力的', 'competitive', 'adjective', 'business'],
  ['真心地', 'truly', 'adverb', 'grammar'],
  ['嗨', 'hi', 'other', 'communication'],
  ['習慣', 'habit', 'noun', 'daily'],
  ['磁碟', 'disk', 'noun', 'tech'],
  ['核心', 'core', 'noun', 'abstract'],
  ['情緒化的', 'emotional', 'adjective', 'emotion'],
  ['航空器', 'aircraft', 'noun', 'travel'],
  ['自我', 'self', 'noun', 'abstract'],
  ['金屬', 'metal', 'noun', 'manufacturing'],
  ['存在狀態', 'existence', 'noun', 'abstract'],
  ['骨頭', 'bone', 'noun', 'body'],
  ['面板', 'panel', 'noun', 'tech'],
  ['最佳的', 'prime', 'adjective', 'quality'],
  ['預約', 'appointment', 'noun', 'office'],
  ['強調', 'emphasize', 'verb', 'communication'],
  ['最大值', 'maximum', 'noun', 'quantity'],
  ['有效地', 'effectively', 'adverb', 'quality'],
  ['在別處', 'elsewhere', 'other', 'place'],
  ['打擾', 'bother', 'verb', 'emotion'],
  ['主動措施', 'initiative', 'noun', 'business'],
  ['銳利的', 'sharp', 'adjective', 'quality'],
  ['飲食', 'diet', 'noun', 'health'],
  ['動議', 'motion', 'noun', 'business'],
  ['灰色的', 'gray', 'adjective', 'color'],
  ['塑膠', 'plastic', 'noun', 'manufacturing'],
  ['使複雜', 'complicate', 'verb', 'abstract'],
  ['紀律', 'discipline', 'noun', 'education'],
  ['使失望', 'disappoint', 'verb', 'emotion'],
  ['老闆', 'boss', 'noun', 'hr'],
  ['假設前提', 'assumption', 'noun', 'abstract'],
  ['凍結', 'freeze', 'verb', 'finance'],
  ['極端的', 'extreme', 'adjective', 'quantity'],
  ['段落', 'passage', 'noun', 'media'],
  ['名聲', 'reputation', 'noun', 'society'],
  ['往外', 'forth', 'adverb', 'movement'],
  ['談判', 'negotiation', 'noun', 'business'],
  ['機制', 'mechanism', 'noun', 'manufacturing'],
  ['外套', 'coat', 'noun', 'clothing'],
  ['民主', 'democracy', 'noun', 'society'],
  ['口袋', 'pocket', 'noun', 'clothing'],
  ['幸運的', 'lucky', 'adjective', 'emotion'],
  ['撞毀', 'crash', 'verb', 'transport'],
  ['觀察結果', 'observation', 'noun', 'abstract'],
  ['肉類', 'meat', 'noun', 'food'],
  ['專注度', 'concentration', 'noun', 'abstract'],
  ['隱含意義', 'implication', 'noun', 'abstract'],
  ['值得獲得', 'deserve', 'verb', 'abstract'],
  ['不尋常的', 'unusual', 'adjective', 'quality'],
  ['辯護', 'defend', 'verb', 'law'],
  ['經典的', 'classic', 'adjective', 'entertainment'],
  ['國王', 'king', 'noun', 'society'],
  ['互動', 'interaction', 'noun', 'society'],
  ['修繕', 'repair', 'verb', 'manufacturing'],
  ['崩塌', 'collapse', 'verb', 'realestate'],
  ['借入', 'borrow', 'verb', 'finance'],
  ['基礎性的', 'fundamental', 'adjective', 'quality'],
  ['菜餚', 'dish', 'noun', 'dining'],
  ['在國外', 'abroad', 'adverb', 'travel'],
  ['靈魂', 'soul', 'noun', 'abstract'],
  ['有本事的', 'capable', 'adjective', 'quality'],
  ['敗仗', 'defeat', 'noun', 'sport'],
  ['總統的', 'presidential', 'adjective', 'society'],
  ['完美地', 'perfectly', 'adverb', 'quality'],
  ['增進', 'enhance', 'verb', 'business'],
  ['自豪的', 'proud', 'adjective', 'emotion'],
  ['緊急事件', 'emergency', 'noun', 'society'],
  ['教育性的', 'educational', 'adjective', 'education'],
  ['分辨', 'distinguish', 'verb', 'abstract'],
  ['可觀的', 'substantial', 'adjective', 'quantity'],
  ['附近的', 'nearby', 'adjective', 'place'],
  ['製造商', 'manufacturer', 'noun', 'manufacturing'],
  ['滑動', 'slide', 'verb', 'movement'],
  ['有價值的', 'valuable', 'adjective', 'quality'],
  ['就個人而言', 'personally', 'adverb', 'society'],
  ['胸部', 'breast', 'noun', 'body'],
  ['應付', 'cope', 'verb', 'abstract'],
  ['大約', 'approximately', 'adverb', 'quantity'],
  ['住宿', 'accommodation', 'noun', 'travel'],
  ['重點標示', 'highlight', 'noun', 'media'],
  ['記者', 'reporter', 'noun', 'media'],
  ['氣候', 'climate', 'noun', 'weather'],
  ['襯衫', 'shirt', 'noun', 'clothing'],
  ['例外', 'exception', 'noun', 'quality'],
  ['法人企業', 'corporation', 'noun', 'business'],
  ['晶片', 'chip', 'noun', 'tech'],
  ['優勝者', 'winner', 'noun', 'sport'],
  ['遭遇', 'encounter', 'verb', 'abstract'],
  ['棕色的', 'brown', 'adjective', 'color'],
  ['吸吐', 'breathe', 'verb', 'body'],
  ['藉口', 'excuse', 'noun', 'communication'],
  ['有一部分', 'partly', 'adverb', 'quantity'],
  ['都市的', 'urban', 'adjective', 'place'],
  ['使混淆', 'confuse', 'verb', 'abstract'],
  ['南部的', 'southern', 'adjective', 'place'],
  ['輸出量', 'output', 'noun', 'manufacturing'],
  ['美', 'beauty', 'noun', 'quality'],
  ['巨型的', 'massive', 'adjective', 'quantity'],
  ['裝設', 'install', 'verb', 'tech'],
  ['計算出', 'calculate', 'verb', 'abstract'],
  ['滑鼠', 'mouse', 'noun', 'tech'],
  ['數學', 'mathematics', 'noun', 'education'],
  ['上方的', 'upper', 'adjective', 'place'],
  ['創作', 'creation', 'noun', 'entertainment'],
  ['佔用', 'occupy', 'verb', 'realestate'],
  ['綱要', 'outline', 'noun', 'office'],
  ['足量的', 'sufficient', 'adjective', 'quantity'],
  ['更新', 'update', 'verb', 'tech'],
  ['運氣', 'luck', 'noun', 'emotion'],
  ['保存', 'preserve', 'verb', 'food'],
  ['分割', 'split', 'verb', 'quantity'],
  ['擺盪', 'swing', 'verb', 'movement'],
  ['病症', 'illness', 'noun', 'health'],
  ['突如其來的', 'sudden', 'adjective', 'time'],
  ['一致的', 'consistent', 'adjective', 'quality'],
  ['原本', 'originally', 'adverb', 'time'],
  ['到一旁', 'aside', 'adverb', 'movement'],
  ['安慰', 'comfort', 'noun', 'emotion'],
  ['第二點', 'secondly', 'adverb', 'grammar'],
  ['嚴重的', 'severe', 'adjective', 'quality'],
  ['基因', 'gene', 'noun', 'health'],
  ['前景', 'prospect', 'noun', 'business'],
  ['情節', 'plot', 'noun', 'media'],
  ['脖子', 'neck', 'noun', 'body'],
  ['主要是', 'primarily', 'adverb', 'quantity'],
  ['整合', 'integrate', 'verb', 'tech'],
  ['批評', 'criticism', 'noun', 'media'],
  ['慣例', 'convention', 'noun', 'society'],
  ['打賭', 'bet', 'verb', 'entertainment'],
  ['保留住', 'retain', 'verb', 'business'],
  ['順序', 'sequence', 'noun', 'abstract'],
  ['樸素的', 'plain', 'adjective', 'quality'],
  ['志工', 'volunteer', 'noun', 'society'],
  ['鄉村的', 'rural', 'adjective', 'place'],
  ['冷靜的', 'calm', 'adjective', 'emotion'],
  ['棄置', 'abandon', 'verb', 'abstract'],
  ['考試', 'examination', 'noun', 'education'],
  ['寂靜', 'silence', 'noun', 'quality'],
  ['急速地', 'rapidly', 'adverb', 'quality'],
  ['講求效率的', 'efficient', 'adjective', 'quality'],
  ['革命', 'revolution', 'noun', 'society'],
  ['欣喜', 'delight', 'noun', 'emotion'],
  ['拼寫', 'spell', 'verb', 'education'],
  ['立論基礎', 'premise', 'noun', 'abstract'],
  ['傾身', 'lean', 'verb', 'movement'],
  ['戲劇性的', 'dramatic', 'adjective', 'entertainment'],
  ['有差別', 'differ', 'verb', 'abstract'],
  ['感恩的', 'grateful', 'adjective', 'emotion'],
  ['蛋白質', 'protein', 'noun', 'health'],
  ['配送', 'distribute', 'verb', 'logistics'],
  ['智識的', 'intellectual', 'adjective', 'education'],
  ['衍生自', 'derive', 'verb', 'abstract'],
  ['至關重要的', 'crucial', 'adjective', 'quality'],
  ['失業率', 'unemployment', 'noun', 'hr'],
  ['輪子', 'wheel', 'noun', 'transport'],
  ['農作物', 'crop', 'noun', 'nature'],
  ['少數族群', 'minority', 'noun', 'society'],
  ['起源', 'origin', 'noun', 'abstract'],
  ['詮釋', 'interpretation', 'noun', 'abstract'],
  ['紳士', 'gentleman', 'noun', 'society'],
  ['戲劇', 'drama', 'noun', 'entertainment'],
  ['地貌', 'landscape', 'noun', 'nature'],
  ['教育培養', 'educate', 'verb', 'education'],
  ['玩具', 'toy', 'noun', 'entertainment'],
  ['過失', 'fault', 'noun', 'quality'],
  ['陳展', 'exhibit', 'verb', 'entertainment'],
  ['次要的', 'minor', 'adjective', 'quality'],
  ['狩獵', 'hunt', 'verb', 'sport'],
  ['暴風雨', 'storm', 'noun', 'weather'],
  ['厚的', 'thick', 'adjective', 'quality'],
  ['功績', 'achievement', 'noun', 'abstract'],
  ['協商', 'negotiate', 'verb', 'business'],
  ['拍攝', 'shoot', 'verb', 'media'],
];

/**
 * 這一批的難度：NGSL 詞頻 1201–2000 名歸「600–800 分」
 */
const LEVEL = 3;

/**
 * 這一批的起始流水號，接在 ngsl-09.js 的 en-w-3055 之後
 */
const START = 3056;

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
