/**
 * 英文單字題庫 · NGSL 第 13 批（詞頻排名 2401–2600）。
 *
 * 來源：New General Service List 1.2（Browne, Culligan & Phillips），CC BY-SA 4.0。
 * 詳細出處與授權見專案根目錄的 CREDITS.md。
 *
 * 整批歸「800–990 分」級（NGSL 詞頻 2001–2801 名）。
 *
 * 排除四個字：
 *   cheese / grandmother —— 已存在
 *   laboratory —— 已收錄的 lab 就是它的縮寫
 *   whilst —— 已收錄的 while 的英式拼法
 *
 * 近義字拉開中文，避免同一個題面對到兩個答案：
 *   tendency     習性        ← 與 trend 趨勢 區隔
 *   permission   准許        ← 與 allow 允許 區隔
 *   mad          氣瘋的      ← 與 crazy 瘋狂的 區隔
 *   electric     通電的      ← 與 electrical 電力的 區隔
 *   wealthy      有錢的      ← 與 rich 富有的 區隔
 *   journal      學術期刊    ← 與 periodical 期刊 區隔
 *   rail         軌條        ← 與 railway 鐵路、track 軌道 區隔
 *   motivate     使有動力    ← 與 encourage 鼓勵、inspire 啟發 區隔
 *   passion      熱愛        ← 與 enthusiasm 熱忱 區隔
 *   dedicate     投身        ← 與 devote 投注心力 區隔
 *   roughly      粗估        ← 與 approximately 大約 區隔
 *   contest      角逐        ← 與 competition 競賽 區隔
 *   praise       稱許        ← 與 compliment 讚美 區隔
 *   classical    古典樂派的  ← 與 classic 經典的 區隔
 *   profession   專門行業    ← 與 occupation 職業 區隔
 *   entertain    使開心      ← 與 hospitality 款待 區隔
 *   therapy      療法        ← 與 treatment 療程 區隔
 *   expenditure  支出總額    ← 與 expense 開銷 區隔
 *   psychological 心理層面的 ← 與 mental 心理的 區隔
 *   dramatically 戲劇化地    ← 與 drastically 劇烈地 區隔
 *   clothing     衣著        ← 與 clothes 衣服 區隔
 *   curious      感到好奇的  ← 與 wonder 好奇 區隔
 *   tale         傳說        ← 與 story 故事 區隔
 *   strengthen   使更強      ← 與 reinforce 強化 區隔
 *   constraint   約束條件    ← 與 restriction 限制條件 區隔
 *   allege       指稱        ← 與 claim 聲稱 區隔
 *   inquiry      詢問事項    ← 與 query 查詢 區隔
 *   concrete     水泥        ← 取名詞義，閃開 specific 具體的
 *   neglect      怠忽        ← 與 ignore 不予理會 區隔
 *   jail         拘留所      ← 與 prison 監獄 區隔
 *   mere         區區的      ← 與 merely 不過是 區隔
 *   pipe         水管        ← 與 tube 管子 區隔
 */

/**
 * [中文, 英文, 詞性, 主題分類]，順序即 NGSL 詞頻排名
 */
const rows = [
  ['離婚', 'divorce', 'noun', 'family'],
  ['毀掉', 'ruin', 'verb', 'abstract'],
  ['埋葬', 'bury', 'verb', 'society'],
  ['法律意見', 'counsel', 'noun', 'law'],
  ['習性', 'tendency', 'noun', 'abstract'],
  ['頻繁的', 'frequent', 'adjective', 'time'],
  ['馬達', 'motor', 'noun', 'manufacturing'],
  ['存活', 'survival', 'noun', 'health'],
  ['櫃檯', 'counter', 'noun', 'marketing'],
  ['持有', 'possess', 'verb', 'finance'],
  ['准許', 'permission', 'noun', 'law'],
  ['山谷', 'valley', 'noun', 'nature'],
  ['漂浮', 'float', 'verb', 'movement'],
  ['氣瘋的', 'mad', 'adjective', 'emotion'],
  ['大大地', 'greatly', 'adverb', 'quantity'],
  ['看得見的', 'visible', 'adjective', 'quality'],
  ['通電的', 'electric', 'adjective', 'tech'],
  ['令人讚嘆的', 'impressive', 'adjective', 'quality'],
  ['演化', 'evolution', 'noun', 'nature'],
  ['意識', 'awareness', 'noun', 'abstract'],
  ['暴力的', 'violent', 'adjective', 'society'],
  ['奴隸', 'slave', 'noun', 'society'],
  ['有錢的', 'wealthy', 'adjective', 'finance'],
  ['建築學', 'architecture', 'noun', 'realestate'],
  ['可接受的', 'acceptable', 'adjective', 'quality'],
  ['學術期刊', 'journal', 'noun', 'media'],
  ['煤炭', 'coal', 'noun', 'manufacturing'],
  ['量測值', 'measurement', 'noun', 'quantity'],
  ['隨機的', 'random', 'adjective', 'quantity'],
  ['順利成功地', 'successfully', 'adverb', 'business'],
  ['使消沉', 'depress', 'verb', 'emotion'],
  ['插圖', 'illustration', 'noun', 'media'],
  ['爆開', 'burst', 'verb', 'movement'],
  ['特權', 'privilege', 'noun', 'society'],
  ['買主', 'buyer', 'noun', 'marketing'],
  ['互相的', 'mutual', 'adjective', 'society'],
  ['軌條', 'rail', 'noun', 'transport'],
  ['使有動力', 'motivate', 'verb', 'hr'],
  ['房貸', 'mortgage', 'noun', 'finance'],
  ['升遷', 'promotion', 'noun', 'hr'],
  ['熱愛', 'passion', 'noun', 'emotion'],
  ['冠軍', 'champion', 'noun', 'sport'],
  ['履行', 'fulfill', 'verb', 'business'],
  ['灰塵', 'dust', 'noun', 'daily'],
  ['投身', 'dedicate', 'verb', 'emotion'],
  ['粗估', 'roughly', 'adverb', 'quantity'],
  ['裙子', 'skirt', 'noun', 'clothing'],
  ['省份', 'province', 'noun', 'place'],
  ['行進', 'march', 'verb', 'movement'],
  ['評鑑', 'evaluation', 'noun', 'business'],
  ['妥協', 'compromise', 'noun', 'business'],
  ['完成達陣', 'accomplish', 'verb', 'abstract'],
  ['弱點', 'weakness', 'noun', 'abstract'],
  ['公告內容', 'announcement', 'noun', 'communication'],
  ['鹽', 'salt', 'noun', 'food'],
  ['瞥一眼', 'glance', 'verb', 'body'],
  ['歌劇', 'opera', 'noun', 'entertainment'],
  ['角逐', 'contest', 'noun', 'sport'],
  ['刷子', 'brush', 'noun', 'daily'],
  ['使尷尬', 'embarrass', 'verb', 'emotion'],
  ['藝廊', 'gallery', 'noun', 'entertainment'],
  ['遺傳的', 'genetic', 'adjective', 'health'],
  ['積極進取的', 'aggressive', 'adjective', 'emotion'],
  ['胸腔', 'chest', 'noun', 'body'],
  ['格式', 'format', 'noun', 'tech'],
  ['文學性的', 'literary', 'adjective', 'education'],
  ['治理', 'govern', 'verb', 'society'],
  ['擁抱', 'embrace', 'verb', 'emotion'],
  ['稱許', 'praise', 'verb', 'communication'],
  ['無聲的', 'silent', 'adjective', 'quality'],
  ['幫浦', 'pump', 'noun', 'manufacturing'],
  ['出版社', 'publisher', 'noun', 'media'],
  ['慶祝活動', 'celebration', 'noun', 'entertainment'],
  ['高爾夫球', 'golf', 'noun', 'sport'],
  ['補償金', 'compensation', 'noun', 'finance'],
  ['古典樂派的', 'classical', 'adjective', 'entertainment'],
  ['秤重', 'weigh', 'verb', 'quantity'],
  ['對上', 'versus', 'other', 'preposition'],
  ['赤字', 'deficit', 'noun', 'finance'],
  ['修訂', 'modify', 'verb', 'tech'],
  ['閃光', 'flash', 'noun', 'media'],
  ['友誼', 'friendship', 'noun', 'society'],
  ['專門行業', 'profession', 'noun', 'hr'],
  ['字面上', 'literally', 'adverb', 'grammar'],
  ['方程式', 'equation', 'noun', 'education'],
  ['手勢', 'gesture', 'noun', 'body'],
  ['使開心', 'entertain', 'verb', 'dining'],
  ['極出色的', 'fantastic', 'adjective', 'quality'],
  ['指派', 'assign', 'verb', 'office'],
  ['通膨', 'inflation', 'noun', 'finance'],
  ['具歷史意義的', 'historic', 'adjective', 'education'],
  ['使受傷', 'injure', 'verb', 'health'],
  ['遠端的', 'remote', 'adjective', 'tech'],
  ['療法', 'therapy', 'noun', 'health'],
  ['橘色的', 'orange', 'adjective', 'color'],
  ['扭轉', 'twist', 'verb', 'movement'],
  ['人事單位', 'personnel', 'noun', 'hr'],
  ['想像力', 'imagination', 'noun', 'abstract'],
  ['不同意', 'disagree', 'verb', 'communication'],
  ['喉嚨', 'throat', 'noun', 'body'],
  ['洞見', 'insight', 'noun', 'abstract'],
  ['著手應對', 'tackle', 'verb', 'business'],
  ['永遠', 'forever', 'adverb', 'time'],
  ['超出', 'exceed', 'verb', 'quantity'],
  ['支出總額', 'expenditure', 'noun', 'finance'],
  ['喜悅', 'joy', 'noun', 'emotion'],
  ['懷孕的', 'pregnant', 'adjective', 'health'],
  ['可信賴的', 'reliable', 'adjective', 'quality'],
  ['裝備', 'gear', 'noun', 'manufacturing'],
  ['詩人', 'poet', 'noun', 'media'],
  ['財運', 'fortune', 'noun', 'finance'],
  ['典禮', 'ceremony', 'noun', 'entertainment'],
  ['一疊', 'pile', 'noun', 'quantity'],
  ['豬', 'pig', 'noun', 'animal'],
  ['混合物', 'mixture', 'noun', 'manufacturing'],
  ['自動地', 'automatically', 'adverb', 'tech'],
  ['學者', 'scholar', 'noun', 'education'],
  ['心理層面的', 'psychological', 'adjective', 'health'],
  ['戲劇化地', 'dramatically', 'adverb', 'quantity'],
  ['利害關係', 'stake', 'noun', 'business'],
  ['生物', 'creature', 'noun', 'animal'],
  ['合夥關係', 'partnership', 'noun', 'business'],
  ['參加', 'participation', 'noun', 'society'],
  ['條文', 'clause', 'noun', 'law'],
  ['罰則', 'penalty', 'noun', 'law'],
  ['議事廳', 'chamber', 'noun', 'society'],
  ['花俏的', 'fancy', 'adjective', 'quality'],
  ['詩歌', 'poetry', 'noun', 'media'],
  ['閒聊', 'chat', 'verb', 'communication'],
  ['衣著', 'clothing', 'noun', 'clothing'],
  ['演變', 'evolve', 'verb', 'nature'],
  ['緣故', 'sake', 'noun', 'abstract'],
  ['架子', 'shelf', 'noun', 'house'],
  ['提振', 'boost', 'verb', 'business'],
  ['尾巴', 'tail', 'noun', 'animal'],
  ['所有物', 'possession', 'noun', 'finance'],
  ['墮胎', 'abortion', 'noun', 'health'],
  ['感到好奇的', 'curious', 'adjective', 'emotion'],
  ['木製的', 'wooden', 'adjective', 'manufacturing'],
  ['榮景', 'boom', 'noun', 'finance'],
  ['傳說', 'tale', 'noun', 'media'],
  ['民主的', 'democratic', 'adjective', 'society'],
  ['維修保養', 'maintenance', 'noun', 'manufacturing'],
  ['結果就', 'consequently', 'other', 'conjunction'],
  ['鍋子', 'pot', 'noun', 'house'],
  ['牛', 'cow', 'noun', 'animal'],
  ['使更強', 'strengthen', 'verb', 'business'],
  ['約束條件', 'constraint', 'noun', 'abstract'],
  ['摺疊', 'fold', 'verb', 'daily'],
  ['垃圾桶', 'bin', 'noun', 'house'],
  ['經歷', 'undergo', 'verb', 'health'],
  ['潛在地', 'potentially', 'adverb', 'abstract'],
  ['範疇', 'scope', 'noun', 'quantity'],
  ['假裝', 'pretend', 'verb', 'emotion'],
  ['多元', 'diversity', 'noun', 'society'],
  ['指稱', 'allege', 'verb', 'law'],
  ['驕傲', 'pride', 'noun', 'emotion'],
  ['強烈的', 'intense', 'adjective', 'quality'],
  ['詢問事項', 'inquiry', 'noun', 'communication'],
  ['請辭', 'resign', 'verb', 'hr'],
  ['工藝', 'craft', 'noun', 'entertainment'],
  ['嚴格的', 'strict', 'adjective', 'quality'],
  ['水泥', 'concrete', 'noun', 'manufacturing'],
  ['外殼', 'shell', 'noun', 'manufacturing'],
  ['該死', 'damn', 'other', 'communication'],
  ['截然不同的', 'distinct', 'adjective', 'quality'],
  ['幽默', 'humor', 'noun', 'emotion'],
  ['侷限', 'limitation', 'noun', 'abstract'],
  ['跡象', 'indication', 'noun', 'abstract'],
  ['穩定性', 'stability', 'noun', 'quality'],
  ['有智慧的', 'wise', 'adjective', 'quality'],
  ['怠忽', 'neglect', 'verb', 'quality'],
  ['譜寫', 'compose', 'verb', 'entertainment'],
  ['拘留所', 'jail', 'noun', 'law'],
  ['避難所', 'shelter', 'noun', 'society'],
  ['區區的', 'mere', 'adjective', 'quantity'],
  ['碳', 'carbon', 'noun', 'nature'],
  ['監管規範', 'regulate', 'verb', 'law'],
  ['觸發', 'trigger', 'verb', 'tech'],
  ['水管', 'pipe', 'noun', 'manufacturing'],
  ['破壞', 'destruction', 'noun', 'society'],
  ['吉他', 'guitar', 'noun', 'entertainment'],
  ['旗幟', 'flag', 'noun', 'society'],
  ['鋼琴', 'piano', 'noun', 'entertainment'],
  ['魔法', 'magic', 'noun', 'entertainment'],
  ['謎團', 'mystery', 'noun', 'media'],
  ['滑雪', 'ski', 'verb', 'sport'],
  ['低語', 'whisper', 'verb', 'communication'],
  ['後方的', 'rear', 'adjective', 'place'],
  ['菜單', 'menu', 'noun', 'dining'],
  ['物種', 'species', 'noun', 'animal'],
  ['月亮', 'moon', 'noun', 'nature'],
  ['想來', 'presumably', 'adverb', 'grammar'],
  ['祝福', 'bless', 'verb', 'society'],
  ['航空公司', 'airline', 'noun', 'travel'],
  ['修正案', 'amendment', 'noun', 'law'],
];

/**
 * 這一批的難度：NGSL 詞頻 2001–2801 名歸「800–990 分」
 */
const LEVEL = 4;

/**
 * 這一批的起始流水號，接在 ngsl-12.js 的 en-w-3637 之後
 */
const START = 3638;

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
