/**
 * 語法角色對照表。
 * 文法頁的雙排色塊靠這張表決定每一塊的中文標籤與顏色，
 * 同一個角色在中文排與目標語言排必須用同一個顏色，語序差異才看得出來。
 *
 * 色碼本身不寫在這裡——實際的值定義在 assets/css/theme.css 的 :root，
 * 這裡只保留變數名稱。全站色彩因此只有一個真實來源，換配色不必兩邊改。
 */
export const ROLES = {
  subject: { label: '主詞', color: 'var(--r-subject)' },
  verb: { label: '動詞', color: 'var(--r-verb)' },
  object: { label: '受詞', color: 'var(--r-object)' },
  time: { label: '時間', color: 'var(--r-time)' },
  place: { label: '地點', color: 'var(--r-place)' },
  adjective: { label: '形容詞', color: 'var(--r-adjective)' },
  negation: { label: '否定', color: 'var(--r-negation)' },
  particle: { label: '助詞', color: 'var(--r-particle)' },
  other: { label: '其他', color: 'var(--r-other)' },
};

/**
 * 角色名稱清單，供資料驗證用
 */
export const ROLE_KEYS = Object.keys(ROLES);

/**
 * 助詞在中文句裡沒有對應詞，中文排要畫成佔位的窄區塊而不是留白錯位
 */
export const PLACEHOLDER_ROLES = ['particle'];
