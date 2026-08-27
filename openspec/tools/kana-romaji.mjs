/**
 * 假名轉羅馬拼音（訓令式偏 Hepburn，與專案假名表一致）。
 * 8000 筆日文單字的 romaji 欄位靠這支自動產，不手打。
 */

const BASE = {
  あ:'a',い:'i',う:'u',え:'e',お:'o',
  か:'ka',き:'ki',く:'ku',け:'ke',こ:'ko',
  さ:'sa',し:'shi',す:'su',せ:'se',そ:'so',
  た:'ta',ち:'chi',つ:'tsu',て:'te',と:'to',
  な:'na',に:'ni',ぬ:'nu',ね:'ne',の:'no',
  は:'ha',ひ:'hi',ふ:'fu',へ:'he',ほ:'ho',
  ま:'ma',み:'mi',む:'mu',め:'me',も:'mo',
  や:'ya',ゆ:'yu',よ:'yo',
  ら:'ra',り:'ri',る:'ru',れ:'re',ろ:'ro',
  わ:'wa',ゐ:'i',ゑ:'e',を:'o',ん:'n',
  が:'ga',ぎ:'gi',ぐ:'gu',げ:'ge',ご:'go',
  ざ:'za',じ:'ji',ず:'zu',ぜ:'ze',ぞ:'zo',
  だ:'da',ぢ:'ji',づ:'zu',で:'de',ど:'do',
  ば:'ba',び:'bi',ぶ:'bu',べ:'be',ぼ:'bo',
  ぱ:'pa',ぴ:'pi',ぷ:'pu',ぺ:'pe',ぽ:'po',
  ゔ:'vu',ー:'-',
};

/* 拗音：子音 + 小字。し/ち/じ 這幾行不加 y */
const YOUON = {
  きゃ:'kya',きゅ:'kyu',きょ:'kyo', ぎゃ:'gya',ぎゅ:'gyu',ぎょ:'gyo',
  しゃ:'sha',しゅ:'shu',しょ:'sho', じゃ:'ja',じゅ:'ju',じょ:'jo',
  ちゃ:'cha',ちゅ:'chu',ちょ:'cho', ぢゃ:'ja',ぢゅ:'ju',ぢょ:'jo',
  にゃ:'nya',にゅ:'nyu',にょ:'nyo', ひゃ:'hya',ひゅ:'hyu',ひょ:'hyo',
  びゃ:'bya',びゅ:'byu',びょ:'byo', ぴゃ:'pya',ぴゅ:'pyu',ぴょ:'pyo',
  みゃ:'mya',みゅ:'myu',みょ:'myo', りゃ:'rya',りゅ:'ryu',りょ:'ryo',
  てぃ:'ti',でぃ:'di',ふぁ:'fa',ふぃ:'fi',ふぇ:'fe',ふぉ:'fo',
  うぃ:'wi',うぇ:'we',うぉ:'wo',
};

/* 片假名統一先轉平假名處理，少寫一整份對照表 */
const toHira = (s) =>
  s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

export function toRomaji(kana) {
  const src = toHira(String(kana || ''));
  let out = '';
  let i = 0;

  while (i < src.length) {
    const pair = src.slice(i, i + 2);

    if (YOUON[pair]) { out += YOUON[pair]; i += 2; continue; }

    const ch = src[i];

    /* 促音：重複下一個音節的第一個子音，っち → tchi 用 Hepburn 慣例寫成 tchi */
    if (ch === 'っ') {
      const next = YOUON[src.slice(i + 1, i + 3)] || BASE[src[i + 1]] || '';
      out += next.startsWith('ch') ? 't' : (next[0] || '');
      i += 1;
      continue;
    }

    /* 長音符只在片假名出現，接在母音後面就把該母音拉長 */
    if (ch === 'ー') {
      const last = out.slice(-1);
      if ('aiueo'.includes(last)) out += last;
      i += 1;
      continue;
    }

    /* ん 後面接母音或 y 時加隔音符，避免 しんいち 被讀成 shi-ni-chi */
    if (ch === 'ん') {
      const nextRomaji = YOUON[src.slice(i + 1, i + 3)] || BASE[src[i + 1]] || '';
      out += 'aiueoy'.includes(nextRomaji[0]) ? "n'" : 'n';
      i += 1;
      continue;
    }

    out += BASE[ch] ?? ch;
    i += 1;
  }
  return out;
}
