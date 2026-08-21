/**
 * 句型的雙排色塊排版。
 *
 * 上排是中文語序（依 zhIndex 排序，助詞不顯示），
 * 下排是目標語言語序（依 chunks 陣列順序，助詞照顯示）。
 *
 * 「哪些區塊被移動了」不是人工標註的，而是比對兩排順序算出來的：
 * 取兩個排列的最長共同子序列，落在子序列之外的就是被搬動的那幾塊。
 * 用 LCS 而不是逐位比對，是因為逐位比對會把「一塊移到句尾」誤判成
 * 「後面每一塊都移動了」——那樣整句都標紅，等於沒標。
 */

import { ROLES, TARGET_ONLY_ROLES as PARTICLE_ROLES } from '../data/shared/roles.js';

/**
 * 最長共同子序列，回傳共同保留下來的元素集合
 */
function longestCommonSubsequence(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const kept = new Set();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      kept.add(a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return kept;
}

/**
 * 把一個 chunk 轉成畫得出來的色塊
 */
function toBlock(chunk, chunkIndex, text, moved) {
  const role = ROLES[chunk.role] || ROLES.other;
  return {
    chunkIndex,
    role: chunk.role,
    label: role.label,
    color: role.color,
    text,
    moved,
    isParticle: PARTICLE_ROLES.includes(chunk.role),
  };
}

/**
 * 產生一個句子的雙排排版資料
 */
export function buildLayout(sentence) {
  const chunks = sentence?.chunks || [];
  if (chunks.length === 0) {
    return { zhRow: [], targetRow: [], hasOrderDiff: false };
  }

  /* 中文排：濾掉沒有中文對應的區塊（助詞），再依 zhIndex 排序 */
  const zhOrder = chunks
    .map((chunk, chunkIndex) => ({ chunk, chunkIndex }))
    .filter(({ chunk }) => !PARTICLE_ROLES.includes(chunk.role) && chunk.zh !== '')
    .sort((a, b) => a.chunk.zhIndex - b.chunk.zhIndex);

  /* 目標語言排：直接用陣列順序 */
  const targetOrder = chunks.map((chunk, chunkIndex) => ({ chunk, chunkIndex }));

  /* 只拿兩排都有的區塊比對語序，助詞不參與 */
  const comparable = new Set(zhOrder.map((x) => x.chunkIndex));
  const zhSeq = zhOrder.map((x) => x.chunkIndex);
  const targetSeq = targetOrder.map((x) => x.chunkIndex).filter((i) => comparable.has(i));
  const kept = longestCommonSubsequence(targetSeq, zhSeq);
  const movedIndices = new Set(targetSeq.filter((i) => !kept.has(i)));

  const zhRow = zhOrder.map(({ chunk, chunkIndex }) =>
    toBlock(chunk, chunkIndex, chunk.zh, movedIndices.has(chunkIndex))
  );
  const targetRow = targetOrder.map(({ chunk, chunkIndex }) =>
    toBlock(chunk, chunkIndex, chunk.target, movedIndices.has(chunkIndex))
  );

  return { zhRow, targetRow, hasOrderDiff: movedIndices.size > 0 };
}
