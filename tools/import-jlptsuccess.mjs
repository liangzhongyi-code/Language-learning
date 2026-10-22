/**
 * JLPTSuccess N5 模擬考題的匯入對照工具。上游原始檔不進版控，只在本機下載後比對。
 *
 * 用法：
 *   node tools/import-jlptsuccess.mjs --check <上游 N5/data 目錄> [--sections moji,goi,bunpou]
 *   node tools/import-jlptsuccess.mjs --draft <上游 N5/data 目錄> --section moji --out <草稿檔>
 *
 * 下載固定版本（以 moji 第 1 回為例，其餘照 papers/{moji,goi,bunpou}/paper-1..7.json）：
 *   https://raw.githubusercontent.com/gauravaccentureproducts/JLPTSuccess/<SOURCE_COMMIT>/N5/data/papers/moji/paper-1.json
 * 用 curl 原樣下載；不要用會轉換換行的方式取得，否則雜湊不會相符。
 *
 * --check：逐檔驗 SHA-256，不符立即拒絕；再逐題比對已進版控的題庫與上游。
 *   與上游不同卻沒寫 edited、寫了 edited 卻與上游相同、上游題目既沒收也沒列進排除表，都算失敗。
 *   格式正規化（<u> 改成 underline 欄位、括號空格寫法、言い換え題開頭的「A: 」）不算差異。
 * --draft：把一個區段轉成批次檔草稿（note 留空、上游英文解說放註解），供人工逐題審查後再寫入題庫。
 *   草稿不是題庫；草稿檔不得直接當成已審查的資料提交。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JLPT_BLANK, jlptMondaiOf } from '../assets/js/core/jlpt-mondai.js';

export const SOURCE_REPO = 'https://github.com/gauravaccentureproducts/JLPTSuccess';
export const SOURCE_COMMIT = '708a995691dcd0983e2ede47db423281b1cd343a';

/**
 * 固定 commit 的上游檔案雜湊（2026-10-22 以 curl 取得 raw 檔計算）
 */
export const SOURCE_SHA256 = Object.freeze({
  'papers/moji/paper-1.json': '17c531dd85c47efbdb674846810e0cf854ecdd84c3e299ebbcf784480ce5ac81',
  'papers/moji/paper-2.json': '3a749745162d3c4d7d66b4707f630b209002b89ba2abe230a00a88f9bd37d9e6',
  'papers/moji/paper-3.json': '12165d9d3eeb6df36733295b85278483ed215b2b00d9f8a06fed038f65f563e9',
  'papers/moji/paper-4.json': 'e60cda42b4ddeb62e2bf54e628a86affca7f333015f3f280249dc83af4c11e16',
  'papers/moji/paper-5.json': '61455e54a326792740c3cd1faec8461b62a8c8f4555f67ec4acfb31828102d9d',
  'papers/moji/paper-6.json': '2729bb80eb3bb9bba3870d40e571b6ae14871cea45208c5821a4c46a6dddb4cf',
  'papers/moji/paper-7.json': 'c8ce57989047270289ce690f1abba9f6ffb04a95f6607b0e213df9154a9de48c',
  'papers/goi/paper-1.json': 'f14cf7f01faaf4b791fb3c65bede68a6a731de00b9ed94562b7b75943c7f16d7',
  'papers/goi/paper-2.json': 'aa5dd5f5f68f8df3ba687c78d16365b52681c90af8b07b89023e5ddfc4ebc834',
  'papers/goi/paper-3.json': '073acfd6ad900826d2a93c06b2548b476c0b61de2c5ac9da777b7b4d2c5ab75c',
  'papers/goi/paper-4.json': 'a7d10f82d58e2293106c195efbc441a1e8916cf627b018764a374605029b9286',
  'papers/goi/paper-5.json': 'af6988e8def52e3031681f1bb5a2beb4b10bd71a94c3cfa2f6f8ea2205237e96',
  'papers/goi/paper-6.json': 'd3d5ac9a645d390a67f1d385e7553083fbf02b5be9b793748cf89a87b58b8b9f',
  'papers/goi/paper-7.json': '9571c4234d06dff69a5bf01863fab2c2c2943659bde2eba4e3d27a21776259d8',
  'papers/bunpou/paper-1.json': 'da4e79645f67760c2f9ee66f7953624302cca9dc4497da929c194820f2eddb67',
  'papers/bunpou/paper-2.json': '0ed6e4b17229f0207a9137a0334c0993d5b6d7270b267493f2df0ac16e5e92c1',
  'papers/bunpou/paper-3.json': 'aa574a58cb45c8470dff49b9e383307f6ca32e0119e817e80cf68822297e8b8e',
  'papers/bunpou/paper-4.json': '6d3d7a787d84f627fb7e8634ebdd8bda1718670f1e72c832aa768396e16c2c0e',
  'papers/bunpou/paper-5.json': '92487347ad6c11ab72f3842249aba7cb69d3faee466cec8f35cfea76cddb1381',
  'papers/bunpou/paper-6.json': 'd6607636cafec6e81d360535753b2e6a33aa69afece740dc60eb94425b12e54c',
  'papers/bunpou/paper-7.json': '68459c47eef6583bc0b9c47a19d386b4737f6b38127957e41f71fba23462859c',
});

export const SECTIONS = ['moji', 'goi', 'bunpou'];

/**
 * 草稿的起始流水號。三個批次檔各占一段，可以分開撰寫而不會撞號；
 * 正式題庫要求整份連號，排除題目後要把後面區段的號碼往前補（見 ja/jlpt.js）。
 */
export const ID_START = Object.freeze({ moji: 1, goi: 101, bunpou: 201 });

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/**
 * 上游題目轉成本專案的欄位。只做格式正規化，不改內容：
 * 底線標籤改存 underline、括號空格統一寫法、言い換え題拿掉開頭的「A: 」。
 */
export function normalizeUpstream(question, section) {
  const mondai = jlptMondaiOf(section, question.mondai);
  if (!mondai) return null;
  const html = String(question.stem_html ?? '');
  const marks = [...html.matchAll(/<u>(.*?)<\/u>/g)].map((m) => m[1]);
  let stem = html.replace(/<\/?u>/g, '');
  if (/<[^>]+>/.test(stem)) throw new Error(`${question.id} 題面含無法處理的 HTML 標籤`);
  stem = stem.replace(/（[\s　]*）/g, JLPT_BLANK);
  if (mondai.form === 'paraphrase') stem = stem.replace(/^[A-ZＡ-Ｚ][:：]\s*/, '');
  const options = (question.choices || []).map((c) => String(c).trim());
  return {
    sourceRef: question.id,
    section,
    mondai: question.mondai,
    stem: stem.trim(),
    underline: mondai.form === 'underline' ? (marks.length === 1 ? marks[0] : null) : null,
    options,
    answer: options[question.correctIndex] ?? null,
    rationale: question.rationale ?? '',
  };
}

/**
 * 讀上游檔並驗雜湊。任何一個檔不符就整批拒絕，不做部分比對。
 */
export async function loadUpstream(dir, { sections = SECTIONS, hashes = SOURCE_SHA256 } = {}) {
  const items = [];
  const mismatched = [];
  for (const section of sections) {
    for (let paper = 1; paper <= 7; paper++) {
      const path = `papers/${section}/paper-${paper}.json`;
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
      for (const q of JSON.parse(raw.toString('utf8')).questions) {
        const item = normalizeUpstream(q, section);
        if (item) items.push(item);
      }
    }
  }
  if (mismatched.length) {
    throw new Error(`上游檔案與固定 commit ${SOURCE_COMMIT.slice(0, 7)} 的雜湊不符，拒絕比對：\n  ${mismatched.join('\n  ')}`);
  }
  return items;
}

const comparable = (item) => JSON.stringify([item.stem, item.underline, item.options, item.answer]);

/**
 * 比對題庫與上游。回傳錯誤清單；空陣列代表一致。
 * sections 只比對指定的區段，題庫裡其他區段的題目不受影響。
 */
export function compareWithUpstream({ upstream, data, excluded = [], sections = SECTIONS }) {
  const errors = [];
  const bySource = new Map(upstream.map((u) => [u.sourceRef, u]));
  const inScope = (ref) => sections.some((s) => String(ref).startsWith(`${s}-`));
  const used = new Map();
  for (const item of data.filter((d) => inScope(d.sourceRef))) {
    const source = bySource.get(item.sourceRef);
    if (!source) {
      errors.push(`${item.id}：上游沒有 ${item.sourceRef}（或不在本批題型內）`);
      continue;
    }
    if (used.has(item.sourceRef)) errors.push(`${item.id}：${item.sourceRef} 已對應 ${used.get(item.sourceRef)}`);
    used.set(item.sourceRef, item.id);
    if (item.section !== source.section || item.mondai !== source.mondai) {
      errors.push(`${item.id}：題型與上游 ${item.sourceRef} 不同（${item.section} 問題${item.mondai}）`);
    }
    const same = comparable(item) === comparable(source);
    if (!same && item.edited === null) errors.push(`${item.id}：與上游 ${item.sourceRef} 不同，但 edited 沒寫原因`);
    if (same && item.edited !== null) errors.push(`${item.id}：edited 寫了原因，但內容與上游 ${item.sourceRef} 相同`);
  }
  const skipped = new Map();
  for (const { sourceRef, reason } of excluded.filter((e) => inScope(e.sourceRef))) {
    if (!bySource.has(sourceRef)) errors.push(`排除表：上游沒有 ${sourceRef}`);
    if (used.has(sourceRef)) errors.push(`排除表：${sourceRef} 已收錄為 ${used.get(sourceRef)}，不能同時排除`);
    if (skipped.has(sourceRef)) errors.push(`排除表：${sourceRef} 重複列出`);
    if (typeof reason !== 'string' || !reason.trim()) errors.push(`排除表：${sourceRef} 沒寫原因`);
    skipped.set(sourceRef, reason);
  }
  for (const u of upstream) {
    if (inScope(u.sourceRef) && !used.has(u.sourceRef) && !skipped.has(u.sourceRef)) {
      errors.push(`上游 ${u.sourceRef} 沒有收錄，也不在排除表`);
    }
  }
  return errors;
}

const literal = (value) => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;

/**
 * 產生一個區段的批次檔草稿。id 依上游順序從該區段的起始號連號。
 */
export function draftSection(upstream, section) {
  const rows = upstream.filter((u) => u.section === section);
  const body = rows.map((u, i) => {
    const id = `ja-j-${String(ID_START[section] + i).padStart(4, '0')}`;
    return [
      `  /* 上游 ${u.sourceRef}：${u.rationale.replace(/\*\//g, '* /').replace(/\s+/g, ' ').trim()} */`,
      '  {',
      `    id: '${id}', level: 1, section: '${section}', mondai: ${u.mondai},`,
      `    stem: ${literal(u.stem)}, underline: ${u.underline === null ? 'null' : literal(u.underline)},`,
      `    options: [${u.options.map(literal).join(', ')}],`,
      `    answer: ${literal(u.answer)},`,
      "    note: '',",
      `    sourceRef: '${u.sourceRef}', edited: null,`,
      '  },',
    ].join('\n');
  });
  return `/* 草稿：${section}，${rows.length} 題，由 tools/import-jlptsuccess.mjs 產生，尚未審查 */\nexport const jlpt = [\n${body.join('\n')}\n];\n`;
}

function argValue(args, name) {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

async function main(args) {
  const checkDir = argValue(args, '--check');
  const draftDir = argValue(args, '--draft');
  if (checkDir) {
    const sections = (argValue(args, '--sections') ?? SECTIONS.join(',')).split(',');
    if (sections.some((s) => !SECTIONS.includes(s))) throw new Error(`--sections 只能是 ${SECTIONS.join(',')}`);
    const upstream = await loadUpstream(checkDir, { sections });
    const { jlpt, jlptExcluded } = await import(pathToFileURL(fileURLToPath(new URL('../assets/js/data/ja/jlpt.js', import.meta.url))).href);
    const errors = compareWithUpstream({ upstream, data: jlpt, excluded: jlptExcluded, sections });
    if (errors.length) {
      console.error(errors.join('\n'));
      process.exitCode = 1;
      return;
    }
    const count = jlpt.filter((d) => sections.some((s) => d.sourceRef.startsWith(`${s}-`))).length;
    console.log(`上游 ${upstream.length} 題（${sections.join('、')}）：收錄 ${count}、排除 ${upstream.length - count}，對照一致。`);
    return;
  }
  if (draftDir) {
    const section = argValue(args, '--section');
    const out = argValue(args, '--out');
    if (!SECTIONS.includes(section) || !out) throw new Error('--draft 需要 --section moji|goi|bunpou 與 --out <草稿檔>');
    await writeFile(out, draftSection(await loadUpstream(draftDir, { sections: [section] }), section));
    console.log(`草稿已寫到 ${out}（尚未審查，不是題庫）`);
    return;
  }
  throw new Error('用法：--check <目錄> [--sections …] 或 --draft <目錄> --section <區段> --out <檔案>');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
