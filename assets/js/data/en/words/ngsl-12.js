/**
 * 英文單字題庫 · NGSL 第 12 批（詞頻排名 2201–2400）。
 *
 * 來源：New General Service List 1.2（Browne, Culligan & Phillips），CC BY-SA 4.0。
 * 詳細出處與授權見專案根目錄的 CREDITS.md。
 *
 * 整批歸「800–990 分」級（NGSL 詞頻 2001–2801 名）。
 *
 * 排除五個字：
 *   pink / bread —— 已存在
 *   exam —— 已收錄的 examination 的縮寫
 *   statistic —— 已收錄的 statistics 的單數
 *   teenager —— 與已收錄的 teen 完全同義
 *
 * 近義字拉開中文，避免同一個題面對到兩個答案：
 *   mode        模態        ← 與 pattern 模式 區隔
 *   awful       可怕的      ← 與 terrible 糟糕的 區隔
 *   web         全球資訊網  ← 與 website 網站、webpage 網頁 區隔
 *   similarly   相似地      ← 與 likewise 同樣地 區隔
 *   dimension   維度        ← 與 aspect 層面 區隔
 *   regularly   按時        ← 與 periodically 定期地 區隔
 *   disturb     攪擾        ← 與 bother 打擾、disrupt 擾亂 區隔
 *   cite        引註        ← 與 quote 引述 區隔
 *   gender      性別身分    ← 與 sex 性別 區隔
 *   dealer      盤商        ← 與 distributor 經銷商 區隔
 *   translate   譯出        ← 與 translation 翻譯 區隔
 *   infant      幼兒        ← 與 baby 嬰兒 區隔
 *   constitute  組成為      ← 與 consist 由…組成 區隔
 *   consultant  諮詢顧問    ← 與 advisor 顧問 區隔
 *   cap         便帽        ← 與 hat 帽子 區隔
 *   rapid       迅捷的      ← 與 fast 快速的 區隔
 *   beneath     位於下方    ← 與 below 低於、under 在…下方 區隔
 *   opponent    敵手        ← 與 rival 對手 區隔
 *   capability  本領        ← 與 ability 能力、capacity 容量 區隔
 */

/**
 * [中文, 英文, 詞性, 主題分類]，順序即 NGSL 詞頻排名
 */
const rows = [
  ['模態', 'mode', 'noun', 'tech'],
  ['鏡子', 'mirror', 'noun', 'house'],
  ['可怕的', 'awful', 'adjective', 'quality'],
  ['擺姿勢', 'pose', 'verb', 'media'],
  ['調整', 'adjust', 'verb', 'manufacturing'],
  ['有創意的', 'creative', 'adjective', 'entertainment'],
  ['現今', 'nowadays', 'adverb', 'time'],
  ['詩', 'poem', 'noun', 'media'],
  ['農業的', 'agricultural', 'adjective', 'nature'],
  ['競爭對手', 'competitor', 'noun', 'business'],
  ['酒精', 'alcohol', 'noun', 'drink'],
  ['節慶', 'festival', 'noun', 'entertainment'],
  ['蔬菜', 'vegetable', 'noun', 'food'],
  ['廂型車', 'van', 'noun', 'transport'],
  ['有自信的', 'confident', 'adjective', 'emotion'],
  ['行星', 'planet', 'noun', 'nature'],
  ['曲線', 'curve', 'noun', 'quality'],
  ['膝蓋', 'knee', 'noun', 'body'],
  ['克服', 'overcome', 'verb', 'abstract'],
  ['全球資訊網', 'web', 'noun', 'tech'],
  ['深度', 'depth', 'noun', 'quantity'],
  ['入口', 'entrance', 'noun', 'place'],
  ['日誌', 'log', 'noun', 'tech'],
  ['巨人', 'giant', 'noun', 'society'],
  ['神', 'god', 'noun', 'society'],
  ['份量', 'portion', 'noun', 'quantity'],
  ['物質', 'substance', 'noun', 'manufacturing'],
  ['廣泛深入的', 'extensive', 'adjective', 'quantity'],
  ['口譯', 'interpret', 'verb', 'communication'],
  ['獨立', 'independence', 'noun', 'society'],
  ['糖', 'sugar', 'noun', 'food'],
  ['內在的', 'inner', 'adjective', 'abstract'],
  ['傷害', 'harm', 'noun', 'quality'],
  ['諮詢請教', 'consult', 'verb', 'business'],
  ['陰影', 'shadow', 'noun', 'nature'],
  ['條狀物', 'strip', 'noun', 'manufacturing'],
  ['平滑的', 'smooth', 'adjective', 'quality'],
  ['介入', 'intervention', 'noun', 'society'],
  ['使印象深刻', 'impress', 'verb', 'emotion'],
  ['副的', 'vice', 'adjective', 'hr'],
  ['激進的', 'radical', 'adjective', 'society'],
  ['相似地', 'similarly', 'adverb', 'quantity'],
  ['表現舉止', 'behave', 'verb', 'abstract'],
  ['大聲的', 'loud', 'adjective', 'quality'],
  ['維度', 'dimension', 'noun', 'abstract'],
  ['隨後的', 'subsequent', 'adjective', 'time'],
  ['感染', 'infection', 'noun', 'health'],
  ['夾克', 'jacket', 'noun', 'clothing'],
  ['效率', 'efficiency', 'noun', 'quality'],
  ['骯髒的', 'dirty', 'adjective', 'quality'],
  ['按時', 'regularly', 'adverb', 'time'],
  ['度假村', 'resort', 'noun', 'travel'],
  ['鐵', 'iron', 'noun', 'manufacturing'],
  ['播送', 'broadcast', 'verb', 'media'],
  ['會籍', 'membership', 'noun', 'society'],
  ['失明的', 'blind', 'adjective', 'health'],
  ['純粹的', 'pure', 'adjective', 'quality'],
  ['血腥的', 'bloody', 'adjective', 'society'],
  ['盟友', 'ally', 'noun', 'society'],
  ['數量', 'quantity', 'noun', 'quantity'],
  ['彎折', 'bend', 'verb', 'movement'],
  ['成熟的', 'mature', 'adjective', 'quality'],
  ['簡短地', 'briefly', 'adverb', 'quality'],
  ['警鈴', 'alarm', 'noun', 'society'],
  ['攪擾', 'disturb', 'verb', 'emotion'],
  ['維持支撐', 'sustain', 'verb', 'abstract'],
  ['洪水', 'flood', 'noun', 'weather'],
  ['貧窮', 'poverty', 'noun', 'society'],
  ['瘋狂的', 'crazy', 'adjective', 'emotion'],
  ['引註', 'cite', 'verb', 'education'],
  ['新近地', 'newly', 'adverb', 'time'],
  ['平行的', 'parallel', 'adjective', 'quality'],
  ['性別身分', 'gender', 'noun', 'society'],
  ['贊助商', 'sponsor', 'noun', 'marketing'],
  ['靴子', 'boot', 'noun', 'clothing'],
  ['精準的', 'accurate', 'adjective', 'quality'],
  ['盤商', 'dealer', 'noun', 'marketing'],
  ['按鈕', 'button', 'noun', 'tech'],
  ['負擔', 'burden', 'noun', 'abstract'],
  ['沙漠', 'desert', 'noun', 'nature'],
  ['伴侶', 'mate', 'noun', 'family'],
  ['偶爾', 'occasionally', 'adverb', 'time'],
  ['持股人', 'shareholder', 'noun', 'finance'],
  ['碗', 'bowl', 'noun', 'dining'],
  ['發現成果', 'discovery', 'noun', 'abstract'],
  ['抗拒', 'resistance', 'noun', 'abstract'],
  ['沐浴', 'bath', 'noun', 'daily'],
  ['頻率', 'frequency', 'noun', 'quantity'],
  ['批判', 'criticize', 'verb', 'media'],
  ['輕點', 'tap', 'verb', 'movement'],
  ['哲學', 'philosophy', 'noun', 'education'],
  ['嘴唇', 'lip', 'noun', 'body'],
  ['歸因於', 'attribute', 'verb', 'abstract'],
  ['致歉', 'apologize', 'verb', 'communication'],
  ['核准通過', 'approval', 'noun', 'business'],
  ['抓取', 'grab', 'verb', 'movement'],
  ['賦予權利', 'entitle', 'verb', 'law'],
  ['借出', 'lend', 'verb', 'finance'],
  ['參與程度', 'involvement', 'noun', 'society'],
  ['曝光度', 'exposure', 'noun', 'media'],
  ['傳統慣例的', 'conventional', 'adjective', 'society'],
  ['數位的', 'digital', 'adjective', 'tech'],
  ['譯出', 'translate', 'verb', 'communication'],
  ['編修', 'edit', 'verb', 'media'],
  ['形成', 'formation', 'noun', 'abstract'],
  ['存款', 'deposit', 'noun', 'finance'],
  ['令人舒服的', 'pleasant', 'adjective', 'emotion'],
  ['海外的', 'overseas', 'adjective', 'travel'],
  ['倡議', 'advocate', 'verb', 'society'],
  ['建置機構', 'establishment', 'noun', 'business'],
  ['摘要', 'summary', 'noun', 'communication'],
  ['粗糙的', 'rough', 'adjective', 'quality'],
  ['筆', 'pen', 'noun', 'office'],
  ['復甦', 'recovery', 'noun', 'finance'],
  ['封條', 'seal', 'noun', 'logistics'],
  ['管子', 'tube', 'noun', 'manufacturing'],
  ['塔樓', 'tower', 'noun', 'realestate'],
  ['描繪特徵', 'characterize', 'verb', 'abstract'],
  ['明確指定', 'specify', 'verb', 'communication'],
  ['精確的', 'exact', 'adjective', 'quality'],
  ['旋轉', 'spin', 'verb', 'movement'],
  ['操作員', 'operator', 'noun', 'manufacturing'],
  ['幼兒', 'infant', 'noun', 'family'],
  ['挖掘', 'dig', 'verb', 'manufacturing'],
  ['拖曳', 'drag', 'verb', 'movement'],
  ['架設', 'mount', 'verb', 'manufacturing'],
  ['包覆', 'wrap', 'verb', 'logistics'],
  ['預先料到', 'anticipate', 'verb', 'abstract'],
  ['依附的', 'dependent', 'adjective', 'abstract'],
  ['專攻', 'specialize', 'verb', 'education'],
  ['角度', 'angle', 'noun', 'quality'],
  ['雞肉', 'chicken', 'noun', 'food'],
  ['焦慮', 'anxiety', 'noun', 'emotion'],
  ['病毒', 'virus', 'noun', 'health'],
  ['精準地', 'precisely', 'adverb', 'quality'],
  ['對手', 'rival', 'noun', 'business'],
  ['冒犯', 'offense', 'noun', 'law'],
  ['偵測', 'detect', 'verb', 'tech'],
  ['欽佩', 'admire', 'verb', 'emotion'],
  ['適度的', 'moderate', 'adjective', 'quantity'],
  ['手術', 'surgery', 'noun', 'health'],
  ['音樂家', 'musician', 'noun', 'entertainment'],
  ['重大意義', 'significance', 'noun', 'abstract'],
  ['淋浴', 'shower', 'noun', 'daily'],
  ['非法的', 'illegal', 'adjective', 'law'],
  ['慈善機構', 'charity', 'noun', 'society'],
  ['普世的', 'universal', 'adjective', 'society'],
  ['香菸', 'cigarette', 'noun', 'health'],
  ['組成為', 'constitute', 'verb', 'abstract'],
  ['足以應付的', 'adequate', 'adjective', 'quantity'],
  ['諮詢顧問', 'consultant', 'noun', 'business'],
  ['歷史學家', 'historian', 'noun', 'education'],
  ['表親', 'cousin', 'noun', 'family'],
  ['視覺的', 'visual', 'adjective', 'media'],
  ['愚蠢的', 'stupid', 'adjective', 'emotion'],
  ['熱衷的', 'keen', 'adjective', 'emotion'],
  ['族裔的', 'ethnic', 'adjective', 'society'],
  ['雙胞胎', 'twin', 'noun', 'family'],
  ['臨床的', 'clinical', 'adjective', 'health'],
  ['東部的', 'eastern', 'adjective', 'place'],
  ['預報', 'forecast', 'noun', 'weather'],
  ['區隔', 'segment', 'noun', 'marketing'],
  ['風俗', 'custom', 'noun', 'society'],
  ['適應', 'adapt', 'verb', 'abstract'],
  ['沙子', 'sand', 'noun', 'nature'],
  ['便帽', 'cap', 'noun', 'clothing'],
  ['促使', 'prompt', 'verb', 'abstract'],
  ['魅力', 'charm', 'noun', 'emotion'],
  ['起反應', 'react', 'verb', 'abstract'],
  ['講座', 'lecture', 'noun', 'education'],
  ['創投事業', 'venture', 'noun', 'business'],
  ['化合物', 'compound', 'noun', 'manufacturing'],
  ['救援', 'rescue', 'verb', 'society'],
  ['一團亂', 'mess', 'noun', 'quality'],
  ['偏好選擇', 'preference', 'noun', 'emotion'],
  ['全面完整的', 'comprehensive', 'adjective', 'quality'],
  ['誘因', 'incentive', 'noun', 'hr'],
  ['聯盟', 'league', 'noun', 'sport'],
  ['對白', 'dialog', 'noun', 'media'],
  ['奶精', 'cream', 'noun', 'food'],
  ['迅捷的', 'rapid', 'adjective', 'quality'],
  ['取消預約', 'cancel', 'verb', 'business'],
  ['後悔', 'regret', 'verb', 'emotion'],
  ['解雇', 'dismiss', 'verb', 'hr'],
  ['利潤空間', 'margin', 'noun', 'finance'],
  ['位於下方', 'beneath', 'other', 'preposition'],
  ['敵手', 'opponent', 'noun', 'sport'],
  ['抵抗', 'resist', 'verb', 'abstract'],
  ['本領', 'capability', 'noun', 'abstract'],
  ['絕對的', 'absolute', 'adjective', 'quantity'],
  ['相對應', 'correspond', 'verb', 'communication'],
  ['中風', 'stroke', 'noun', 'health'],
  ['膽敢', 'dare', 'verb', 'emotion'],
  ['障礙', 'barrier', 'noun', 'abstract'],
  ['擺脫', 'rid', 'verb', 'abstract'],
];

/**
 * 這一批的難度：NGSL 詞頻 2001–2801 名歸「800–990 分」
 */
const LEVEL = 4;

/**
 * 這一批的起始流水號，接在 ngsl-11.js 的 en-w-3442 之後
 */
const START = 3443;

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
