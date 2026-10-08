/**
 * 固定 ts-fsrs 5.4.2 來源，只把 class fields 轉為 ES2020 的 DefineProperty 初始化。
 * 保留完整 MIT 授權與來源／輸出雜湊；來源漂移立即拒絕，沒有執行期 CDN 或新增建置依賴。
 * 用法：node tools/build-fsrs.mjs；--check 只驗證，不寫檔。需要既有 ts-fsrs 開發依賴。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_VERSION = '5.4.2';
export const SOURCE_SHA256 = 'ad4a4b3b7e259fcbf02764454c8f9db4ea3bf5aae2f473198129ecb7728f1a19';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function replaceOnce(source, before, after) {
  const at = source.indexOf(before);
  if (at < 0 || source.indexOf(before, at + before.length) !== -1) throw new Error('固定上游語法不符，停止轉換。');
  return source.slice(0, at) + after + source.slice(at + before.length);
}

/**
 * 只處理已核對雜湊的固定來源；初始化順序與 own-property descriptor 沿用 class field 語意。
 * 基底類別在 constructor 開頭定義，衍生類別在 super 返回後定義，不觸發繼承的 setter。
 */
export function buildFsrsVendor({ pkg, source, license }) {
  if (pkg.version !== EXPECTED_VERSION || pkg.license !== 'MIT' || sha256(source) !== SOURCE_SHA256) {
    throw new Error('ts-fsrs 版本、授權或來源雜湊不符，停止建置。');
  }
  if (!license.startsWith('MIT License') || !license.includes('Copyright (c) 2026 Open Spaced Repetition')) {
    throw new Error('ts-fsrs 授權內容不符，停止建置。');
  }
  let output = source;
  const moveFields = (name, declarations, constructor, fields) => {
    output = replaceOnce(output, `class ${name} {\n${declarations}`, `class ${name} {\n`);
    output = replaceOnce(output, constructor, `${constructor}\n    defineFsrsFields(this, { ${fields} });`);
  };
  moveFields('AbstractScheduler', '  last;\n  current;\n  review_time;\n  next = /* @__PURE__ */ new Map();\n  algorithm;\n  strategies;\n  elapsed_days = 0;\n',
    '  // init\n  constructor(card, now, algorithm, strategies) {',
    'last: void 0, current: void 0, review_time: void 0, next: new Map(), algorithm: void 0, strategies: void 0, elapsed_days: 0');
  moveFields('Alea', '  c;\n  s0;\n  s1;\n  s2;\n', '  constructor(seed) {',
    'c: void 0, s0: void 0, s1: void 0, s2: void 0');
  const prepareParameters = `  prepare_parameters = (params) => {\n    const generated = generatorParameters(params);\n    generated.w = clipParameters(\n      Array.from(generated.w),\n      generated.relearning_steps.length,\n      generated.enable_short_term\n    );\n    return generated;\n  };\n`;
  output = replaceOnce(output, prepareParameters, '');
  const prepareInitializer = prepareParameters.trim().replace('prepare_parameters =', 'prepare_parameters:').replace(/;$/, '');
  moveFields('FSRSAlgorithm', '  param;\n  intervalModifier;\n  _seed;\n', '  constructor(params) {',
    `param: void 0, intervalModifier: void 0, _seed: void 0, ${prepareInitializer}, forgetting_curve: void 0`);
  output = replaceOnce(output, '  forgetting_curve;\n', '');
  moveFields('BasicScheduler extends AbstractScheduler', '  learningStepsStrategy;\n',
    '  constructor(card, now, algorithm, strategies) {\n    super(card, now, algorithm, strategies);',
    'learningStepsStrategy: void 0');
  moveFields('Reschedule', '  fsrs;\n', '  constructor(fsrs) {', 'fsrs: void 0');
  moveFields('FSRS extends FSRSAlgorithm', '  strategyHandler = /* @__PURE__ */ new Map();\n  Scheduler;\n',
    '  constructor(param) {\n    super(param);', 'strategyHandler: new Map(), Scheduler: void 0');
  output = `function defineFsrsFields(instance, fields) {\n  for (const [key, value] of Object.entries(fields)) {\n    Object.defineProperty(instance, key, { value, writable: true, enumerable: true, configurable: true });\n  }\n}\n\n${output}`;
  output = output.replace(/^\/\/# sourceMappingURL=.*\n?$/m, '');
  const header = `/*!\n * ts-fsrs ${pkg.version}（open-spaced-repetition/ts-fsrs）ES2020 class-fields-v1\n * source sha256 ${SOURCE_SHA256}\n * output sha256 ${sha256(output)}\n *\n${license.trim().split('\n').map((line) => ` * ${line}`.trimEnd()).join('\n')}\n */\n`;
  return header + output;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const pkg = JSON.parse(await readFile(join(root, 'node_modules/ts-fsrs/package.json'), 'utf8'));
  const source = await readFile(join(root, 'node_modules/ts-fsrs/dist/index.mjs'), 'utf8');
  const license = await readFile(join(root, 'node_modules/ts-fsrs/LICENSE'), 'utf8');
  const output = buildFsrsVendor({ pkg, source, license });
  const target = join(root, 'assets/js/vendor/ts-fsrs.js');
  if (process.argv.includes('--check')) {
    if (await readFile(target, 'utf8') !== output) throw new Error('vendor 與固定 ES2020 建置不同。');
    console.log('PASS ts-fsrs 5.4.2 ES2020 可重現建置與授權');
  } else {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, output);
    console.log('已輸出 assets/js/vendor/ts-fsrs.js（ts-fsrs 5.4.2 ES2020）');
  }
}
