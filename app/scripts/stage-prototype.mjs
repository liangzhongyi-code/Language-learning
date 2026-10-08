/**
 * 使用既有安全打包器與獨立原型白名單，不擴張正式網站清單。
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { stageWeb } from './stage-web.mjs';

try {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const out = fileURLToPath(new URL('../dist-web/', import.meta.url));
  const manifest = JSON.parse(await readFile(new URL('../prototype-manifest.json', import.meta.url), 'utf8'));
  const result = await stageWeb({ root, out, manifest });
  console.log(`已整理原型 ${result.files.length} 個檔案到 app/dist-web；原生編譯與載入仍需另驗。`);
  if (result.retainedPrevious) console.warn(`舊輸出保留於 ${result.retainedPrevious}，請人工檢查。`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
