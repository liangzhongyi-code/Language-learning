/**
 * 間隔重複的排程。
 *
 * 用 Leitner 盒子，不用 SM-2。
 * SM-2 需要使用者自評 0–5 的熟悉度，而這個網站的作答結果只有對與錯兩種——
 * 硬把二元結果塞進五級量表，排出來的間隔看起來科學但其實是憑空捏造的。
 * Leitner 天生就吃二元評分：答對往上一盒、答錯打回第一盒。
 *
 * 時間一律由呼叫端傳進來，這裡不自己取。理由與亂數相同：
 * 測試要能在固定的時間點上重現同一份排程。
 */

/**
 * 各盒的間隔天數。
 * 第一盒的一天是刻意的——答錯的東西隔天就該再看到，
 * 但不是同一局立刻再考一次（那只是短期記憶，不會留下來）。
 */
export const BOX_DAYS = [1, 3, 7, 16, 35];

/**
 * 最高盒號。到頂之後就停在最長的間隔，不再往上加
 */
export const MAX_BOX = BOX_DAYS.length;

const DAY_MS = 86400000;

/**
 * 盒號一律夾在 1..MAX_BOX。
 * 資料是使用者可以匯入的，不能假設它一定在範圍內
 */
const clampBox = (box) => {
  if (!Number.isInteger(box) || box < 1) return 1;
  return Math.min(box, MAX_BOX);
};

/**
 * 這次作答之後該進哪一盒。
 * 答錯一律回到第一盒，不是退一盒——記錯的東西要當成沒學過重新來，
 * 只退一格會讓一個一直記錯的字在高盒之間反覆橫跳，永遠排不到該有的密度。
 */
export function nextBox(box, correct) {
  return correct ? Math.min(clampBox(box) + 1, MAX_BOX) : 1;
}

/**
 * 在某一盒的話，下次該在什麼時候出現
 */
export function dueAfter(box, now) {
  return now + BOX_DAYS[clampBox(box) - 1] * DAY_MS;
}

/**
 * 這筆記錄到期了沒。沒有 due 的一律視為到期——
 * 那表示它來自更早的資料格式，讓它出現一次重新排程，比永遠不出現好。
 */
export function isDue(record, now) {
  const due = record?.due;
  return !Number.isFinite(due) || due <= now;
}
