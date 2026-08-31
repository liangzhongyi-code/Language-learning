/**
 * 把題目裡的漢字換成假名，以及「漢字標在假名上」的對照資料。
 *
 * 對母語是中文的人來說，日文漢字會直接洩題——看到「寿司」不必會唸日文
 * 也知道是壽司，那一題等於沒考。這裡把顯示用的 target 換成 reading，
 * 讓題目真的考「這個詞怎麼唸」。
 *
 * 換的是資料不是畫面：把整個題庫先轉成假名版再交給出題邏輯，
 * 干擾選項的去重、正解比對、填空的候選詞就全部自動落在假名上，
 * 出題那一側完全不必知道有這個模式存在。
 * 反過來如果只在畫面上換字，去重仍然按漢字算，
 * 「橋」與「箸」會變成兩個都唸 はし 的選項。
 *
 * reading 一律不動，所以朗讀送出去的還是同一串假名。
 */

/**
 * 日文漢字的範圍：CJK 統一表意文字（一-鿿）與擴充 A 區（㐀-䶿），
 * 外加疊字符「々」。
 * 平假名、片假名、長音符刻意不在內——它們本來就不必換。
 */
const KANJI = /[々㐀-䶿一-鿿]/;

/**
 * 這串文字裡有沒有漢字
 */
export function hasKanji(text) {
  return KANJI.test(String(text ?? ''));
}

/**
 * 一筆資料在隱藏漢字模式下該顯示的目標語言文字。
 *
 * 沒有漢字就原樣回傳，不去碰 reading。這一條不是最佳化而是正確性：
 * 「コーヒー」的 reading 是「こーひー」，換過去會變成沒有人這樣寫的日文，
 * 而它本來就一個漢字都沒有，換了也遮不到任何東西。
 */
export function kanaText(item) {
  if (!item || !hasKanji(item.target)) return item?.target;
  return item.reading || item.target;
}

/**
 * 一段文字的「讀什麼／上面標什麼」。
 * ruby 是要標在假名上方的漢字；本來就沒有漢字的段落 ruby 為空字串。
 */
function rubyPair(item) {
  const text = kanaText(item);
  return { text, ruby: text === item?.target ? '' : item.target };
}

/**
 * 一筆資料的假名／漢字對照，給「漢字標在假名上」用。
 *
 * 句子按 chunk 逐塊給，不是整句給一個。
 * 整句只給一對的話，畫面上會變成一長串假名頂著一長串漢字，
 * 哪個漢字對應哪個假名完全看不出來——那個標註就白標了。
 */
export function rubyPairs(item) {
  if (Array.isArray(item?.chunks)) return item.chunks.map(rubyPair);
  return [rubyPair(item)];
}

/**
 * 把一筆資料轉成假名版。句子連同每一塊 chunk 一起轉，填空題才吃得到。
 * withRuby 時額外附上漢字對照，畫面才標得出來。
 */
export function kanaItem(item, withRuby = false) {
  const next = { ...item, target: kanaText(item) };
  if (withRuby) next.ruby = rubyPairs(item);
  if (Array.isArray(item.chunks)) {
    next.chunks = item.chunks.map((chunk) => {
      const swapped = { ...chunk, target: kanaText(chunk) };
      /* 逐塊也要留一份，填空題的候選詞與空格是一塊一塊畫的 */
      if (withRuby) swapped.ruby = swapped.target === chunk.target ? '' : chunk.target;
      return swapped;
    });
  }
  return next;
}

/**
 * 把整個題庫轉成假名版
 */
export function kanaPool(pool, withRuby = false) {
  return (pool || []).map((item) => kanaItem(item, withRuby));
}
