/**
 * Yomitaku N1 讀解題庫的匯入對照工具。上游原始檔不進版控，只在本機下載後比對。
 *
 * 用法：
 *   node tools/import-yomitaku.mjs --check <上游根目錄> [--types tanbun,chubun,…]
 *   node tools/import-yomitaku.mjs --select <上游根目錄>
 *   node tools/import-yomitaku.mjs --draft <上游根目錄> --type tanbun --out <草稿檔>
 *
 * 下載固定版本（六個題型各一檔）：
 *   https://raw.githubusercontent.com/Mocas-12/jlpt-n1-Yomitaku/<SOURCE_COMMIT>/js/bank/<題型>.js
 * 用 curl 原樣下載；換行被轉換過，雜湊就不會相符。
 *
 * 上游題庫是 `window.BANK.push(…);` 包住的 JSON。這裡只當資料讀：取出括號內的文字後 JSON.parse，
 * 絕不 import、eval 或以任何方式執行下載的檔案——資料以外的程式碼一律不會被執行到。
 *
 * --select：依字數下限、避開早期批次，以固定種子排出每個題型的選組順序（前 FIRST_BATCH 組為本批，其後為遞補）。
 * --check：逐檔驗 SHA-256，再逐組比對題庫與上游，並核對「依選組順序收錄或排除」。
 * --draft：把一個題型依選組順序轉成批次檔草稿（解說留空，上游日文解說放在註解）。草稿不是題庫。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JLPT_READING_TYPES, jlptReadingTypeOf } from '../assets/js/core/jlpt-mondai.js';

export const SOURCE_REPO = 'https://github.com/Mocas-12/jlpt-n1-Yomitaku';
export const SOURCE_COMMIT = '2f4ed8ef8c1ac3da343d4adac86969acfe23aaac';

/**
 * 固定 commit 的上游題庫檔雜湊（2026-10-23 以 curl 取得 raw 檔計算）
 */
export const SOURCE_SHA256 = Object.freeze({
  'js/bank/tanbun.js': 'b6cad0938bce5a806e60c03679d5ea393124c1cd8f86a67f58dc7877af7f4196',
  'js/bank/chubun.js': '0afd1d5579d039b8f4939cb3921ddc28f34d895595f1076217c5d22131b51af1',
  'js/bank/chobun.js': 'ff59e77c21f877489e8a9849f2461699a60e749df31bbc05bf44befa8039bccc',
  'js/bank/togo.js': '31aaa2da3b32fb080f64baf923fdd91bb82354d4f3139036f59f117b39d5bbf5',
  'js/bank/shucho.js': 'bddeec096a24b644c9dc944666e3db90e3cf87f747fc4b45ea754d1d0aa9b56d',
  'js/bank/joho.js': '680768656ab27ac56abbd459836d13c8006a6fd5514175b954510a5d027b181f',
});

export const TYPES = JLPT_READING_TYPES.map((t) => t.type);

/**
 * 本批每個題型收幾組
 */
export const FIRST_BATCH = 25;

/**
 * 選組順序的固定種子。改它等於換一批題目，必須連同題庫一起更新並寫進紀錄
 */
export const SELECT_SEED = 20261023;

/**
 * 上游依數字排序後的前幾成視為早期批次，不收（2026-10-22 評估：偏短、陷阱設計少）
 */
export const EARLY_RATIO = 0.15;

/**
 * 上游的簡體中文考點標籤對到本專案的 focus
 */
export const FOCUS_OF_LABEL = Object.freeze({
  主旨把握: 'main', 内容一致: 'detail', 理由说明: 'reason', 划线句含义: 'underline', 指示语: 'reference',
  共通点: 'common', 相違点: 'difference', 条件筛选: 'condition', 注意事项: 'notice',
});

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const numberOf = (id) => Number(String(id).replace(/\D/g, ''));

/**
 * 從上游組 id 的前綴判斷題型，不必載入上游檔。
 * 排除表只記組 id；用 --types 只比對部分題型時，要靠它略過其他題型的排除項。
 */
const PREFIX_TYPE = Object.freeze({ tan: 'tanbun', chu: 'chubun', cho: 'chobun', togo: 'togo', shu: 'shucho', joho: 'joho' });
export const typeOfRef = (ref) => PREFIX_TYPE[(String(ref).match(/^sim-([a-z]+)\d+$/) || [])[1]] ?? null;

/**
 * 取出 `window.BANK.push(` 與最後一個 `);` 之間的文字，當成 JSON 陣列的內容解析。
 * 括號外的任何東西（包括混進來的程式碼）都直接丟掉，括號內不是純 JSON 就整檔拒絕。
 */
export function parseBankFile(text) {
  const head = 'window.BANK.push(';
  const start = text.indexOf(head);
  const end = text.lastIndexOf(');');
  if (start < 0 || end < start) throw new Error('題庫檔格式不符：找不到 window.BANK.push(…); 外框');
  try {
    return JSON.parse(`[${text.slice(start + head.length, end)}]`);
  } catch {
    throw new Error('題庫檔格式不符：外框內不是純 JSON 資料，拒絕解析');
  }
}

/**
 * 上游一組轉成本專案的欄位。只做格式正規化，不改內容：
 * ⟪⟫ 標記拿掉、劃線句另存 underline；考點標籤轉 focus；正解索引轉成正解文字。
 */
export function normalizeUpstream(set) {
  const type = jlptReadingTypeOf(set.typeKey);
  if (!type) return null;
  const marked = (t) => (typeof t === 'string' ? t : null);
  const raw = [marked(set.passage), marked(set.passageA), marked(set.passageB)];
  const underline = raw.map((t) => (t ? (t.match(/⟪(.+?)⟫/) || [])[1] : undefined)).find(Boolean) ?? null;
  const clean = (t) => (t === null ? null : t.replace(/[⟪⟫]/g, '').trim());
  return {
    sourceRef: set.id,
    type: type.type,
    passage: type.dual ? null : clean(raw[0]),
    passageA: type.dual ? clean(raw[1]) : null,
    passageB: type.dual ? clean(raw[2]) : null,
    underline,
    length: (type.dual ? clean(raw[1]) + clean(raw[2]) : clean(raw[0]) ?? '').length,
    questions: set.questions.map((q) => {
      const options = q.options.map((o) => String(o).trim());
      return { focus: FOCUS_OF_LABEL[q.label] ?? null, ask: String(q.q).trim(), options, answer: options[q.answer] ?? null, upstreamExplain: q.explain };
    }),
  };
}

/**
 * 讀上游檔並驗雜湊。任何一個檔不符就整批拒絕
 */
export async function loadUpstream(dir, { types = TYPES, hashes = SOURCE_SHA256 } = {}) {
  const sets = [];
  const mismatched = [];
  for (const type of types) {
    const path = `js/bank/${type}.js`;
    let raw;
    try {
      raw = await readFile(join(dir, path));
    } catch {
      mismatched.push(`${path}（讀不到）`);
      continue;
    }
    if (sha256(raw) !== hashes[path]) {
      mismatched.push(path);
      continue;
    }
    for (const set of parseBankFile(raw.toString('utf8'))) {
      const item = normalizeUpstream(set);
      if (item) sets.push(item);
    }
  }
  if (mismatched.length) {
    throw new Error(`上游檔案與固定 commit ${SOURCE_COMMIT.slice(0, 7)} 的雜湊不符，拒絕比對：\n  ${mismatched.join('\n  ')}`);
  }
  return sets;
}

/**
 * 固定種子的亂數（線性同餘），只用來排選組順序
 */
function seeded(seed) {
  let s = seed % 2147483648;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}

/**
 * 一個題型的選組順序：依數字排序、去掉早期批次與字數不足的組，再以固定種子打亂。
 * 前 FIRST_BATCH 組是本批，後面依序遞補。
 */
export function selectionOrder(upstream, type, { seed = SELECT_SEED } = {}) {
  const def = jlptReadingTypeOf(type);
  const all = upstream.filter((u) => u.type === type).sort((a, b) => numberOf(a.sourceRef) - numberOf(b.sourceRef));
  const eligible = all.slice(Math.ceil(all.length * EARLY_RATIO)).filter((u) => u.length >= def.minChars);
  const rng = seeded(seed + TYPES.indexOf(type));
  const order = [...eligible];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.map((u) => u.sourceRef);
}

const comparable = (item) => JSON.stringify([
  item.passage, item.passageA, item.passageB, item.underline,
  item.questions.map((q) => [q.focus, q.ask, q.options, q.answer]),
]);

/**
 * 比對題庫與上游。回傳錯誤清單；空陣列代表一致。
 * 除了逐組比內容，也核對收錄是否依選組順序：每一組收錄的短文之前，順序上的每一組都必須已收錄或已排除。
 */
export function compareWithUpstream({ upstream, data, excluded = [], types = TYPES, seed = SELECT_SEED, batch = FIRST_BATCH }) {
  const errors = [];
  const bySource = new Map(upstream.map((u) => [u.sourceRef, u]));
  const inScope = (item) => types.includes(item.type ?? bySource.get(item.sourceRef)?.type);
  const used = new Map();
  for (const item of data.filter(inScope)) {
    const source = bySource.get(item.sourceRef);
    if (!source) {
      errors.push(`${item.id}：上游沒有 ${item.sourceRef}`);
      continue;
    }
    if (used.has(item.sourceRef)) errors.push(`${item.id}：${item.sourceRef} 已對應 ${used.get(item.sourceRef)}`);
    used.set(item.sourceRef, item.id);
    if (item.type !== source.type) errors.push(`${item.id}：題型與上游 ${item.sourceRef} 不同`);
    const same = comparable(item) === comparable(source);
    if (!same && item.edited === null) errors.push(`${item.id}：與上游 ${item.sourceRef} 不同，但 edited 沒寫原因`);
    if (same && item.edited !== null) errors.push(`${item.id}：edited 寫了原因，但內容與上游 ${item.sourceRef} 相同`);
  }
  const skipped = new Map();
  for (const { sourceRef, reason } of excluded) {
    /* 不在這次比對範圍的題型直接略過：它們的上游檔沒有載入，查不到不代表不存在 */
    if (!types.includes(typeOfRef(sourceRef))) continue;
    const source = bySource.get(sourceRef);
    if (!source) { errors.push(`排除表：上游沒有 ${sourceRef}`); continue; }
    if (used.has(sourceRef)) errors.push(`排除表：${sourceRef} 已收錄為 ${used.get(sourceRef)}，不能同時排除`);
    if (skipped.has(sourceRef)) errors.push(`排除表：${sourceRef} 重複列出`);
    if (typeof reason !== 'string' || !reason.trim()) errors.push(`排除表：${sourceRef} 沒寫原因`);
    skipped.set(sourceRef, reason);
  }
  for (const type of types) {
    const order = selectionOrder(upstream, type, { seed });
    const kept = order.filter((ref) => used.has(ref));
    if (kept.length > batch) errors.push(`${type}：收錄 ${kept.length} 組，超過本批的 ${batch} 組`);
    const last = Math.max(-1, ...kept.map((ref) => order.indexOf(ref)));
    for (const ref of order.slice(0, last + 1)) {
      if (!used.has(ref) && !skipped.has(ref)) errors.push(`${type}：${ref} 排在已收錄的組之前，卻既沒收錄也沒排除（必須依選組順序遞補）`);
    }
    for (const ref of [...used.keys()].filter((r) => bySource.get(r)?.type === type && !order.includes(r))) {
      errors.push(`${type}：${ref} 不在選組名單內（早期批次或字數不足）`);
    }
  }
  return errors;
}

const literal = (value) => (value === null ? 'null' : `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`);
const comment = (value) => String(value).replace(/\*\//g, '* /').replace(/\s+/g, ' ').trim();

/**
 * 產生一個題型的草稿：依選組順序取前 count 組，組 id 從 start 起連號
 */
export function draftType(upstream, type, { start = 1, count = FIRST_BATCH + 10, seed = SELECT_SEED } = {}) {
  const bySource = new Map(upstream.map((u) => [u.sourceRef, u]));
  const order = selectionOrder(upstream, type, { seed }).slice(0, count);
  const body = order.map((ref, i) => {
    const u = bySource.get(ref);
    const id = `ja-jr-${String(start + i).padStart(4, '0')}`;
    const questions = u.questions.map((q, k) => [
      '      {',
      `        id: '${id}-q${k + 1}', focus: ${literal(q.focus)},`,
      `        ask: ${literal(q.ask)},`,
      `        options: [\n${q.options.map((o) => `          ${literal(o)},`).join('\n')}\n        ],`,
      `        answer: ${literal(q.answer)},`,
      ...q.upstreamExplain.map((e, n) => `        /* 上游解說 ${n + 1}：${comment(e)} */`),
      "        explain: ['', '', '', ''],",
      '      },',
    ].join('\n'));
    return [
      `  /* 選組順序第 ${i + 1}${i >= FIRST_BATCH ? '（遞補）' : ''}：${ref} */`,
      '  {',
      `    id: '${id}', level: 5, type: '${type}',`,
      `    passage: ${literal(u.passage)},`,
      `    passageA: ${literal(u.passageA)},`,
      `    passageB: ${literal(u.passageB)},`,
      `    underline: ${literal(u.underline)},`,
      `    questions: [\n${questions.join('\n')}\n    ],`,
      `    sourceRef: '${ref}', edited: null,`,
      '  },',
    ].join('\n');
  });
  return `/* 草稿：${type}，依選組順序 ${order.length} 組（前 ${FIRST_BATCH} 組為本批，其後為遞補），尚未審查 */\nexport const passages = [\n${body.join('\n')}\n];\n`;
}

function argValue(args, name) {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

async function main(args) {
  const checkDir = argValue(args, '--check');
  const selectDir = argValue(args, '--select');
  const draftDir = argValue(args, '--draft');
  if (checkDir) {
    const types = (argValue(args, '--types') ?? TYPES.join(',')).split(',');
    if (types.some((t) => !TYPES.includes(t))) throw new Error(`--types 只能是 ${TYPES.join(',')}`);
    const upstream = await loadUpstream(checkDir, { types });
    const { jlptReading, jlptReadingExcluded } = await import(pathToFileURL(fileURLToPath(new URL('../assets/js/data/ja/jlpt-reading.js', import.meta.url))).href);
    const errors = compareWithUpstream({ upstream, data: jlptReading, excluded: jlptReadingExcluded, types });
    if (errors.length) {
      console.error(errors.join('\n'));
      process.exitCode = 1;
      return;
    }
    const kept = jlptReading.filter((d) => types.includes(d.type));
    const questions = kept.reduce((sum, d) => sum + d.questions.length, 0);
    console.log(`上游 ${upstream.length} 組（${types.join('、')}）：收錄 ${kept.length} 組 ${questions} 題、排除 ${jlptReadingExcluded.filter((e) => types.some((t) => upstream.find((u) => u.sourceRef === e.sourceRef)?.type === t)).length} 組，對照一致。`);
    return;
  }
  if (selectDir) {
    const upstream = await loadUpstream(selectDir);
    for (const type of TYPES) {
      const order = selectionOrder(upstream, type);
      console.log(`${type}（合格 ${order.length} 組）：本批 ${order.slice(0, FIRST_BATCH).join(' ')}｜遞補 ${order.slice(FIRST_BATCH, FIRST_BATCH + 10).join(' ')}`);
    }
    return;
  }
  if (draftDir) {
    const type = argValue(args, '--type');
    const out = argValue(args, '--out');
    const start = Number(argValue(args, '--start') ?? 1);
    if (!TYPES.includes(type) || !out || !Number.isInteger(start) || start < 1) {
      throw new Error('--draft 需要 --type <題型>、--out <草稿檔>，--start 為正整數');
    }
    await writeFile(out, draftType(await loadUpstream(draftDir, { types: [type] }), type, { start }));
    console.log(`草稿已寫到 ${out}（尚未審查，不是題庫）`);
    return;
  }
  throw new Error('用法：--check <目錄> [--types …]、--select <目錄>，或 --draft <目錄> --type <題型> --out <檔案> [--start N]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
