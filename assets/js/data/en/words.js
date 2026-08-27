/**
 * 英文單字題庫的匯總入口。
 *
 * 題庫是分批匯入的，一批一個檔案放在 words/ 底下，這裡只負責串起來。
 * 這樣做的理由是 git diff：一萬多筆全擠在一個檔案裡，
 * 每次新增一批都會產生一個沒人看得完的 diff，錯誤就會混進去看不見。
 *
 * 新增一批的步驟只有兩步：在 words/ 放新檔、在這裡多兩行。
 *
 * 資料來源與授權見專案根目錄的 CREDITS.md。
 */

import { words as core } from './words/core.js';
import { words as tsl01 } from './words/tsl-01.js';
import { words as tsl02 } from './words/tsl-02.js';
import { words as tsl03 } from './words/tsl-03.js';
import { words as tsl04 } from './words/tsl-04.js';
import { words as tsl05 } from './words/tsl-05.js';
import { words as tsl06 } from './words/tsl-06.js';
import { words as ngsl01 } from './words/ngsl-01.js';
import { words as ngsl02 } from './words/ngsl-02.js';
import { words as ngsl03 } from './words/ngsl-03.js';
import { words as ngsl04 } from './words/ngsl-04.js';
import { words as ngsl05 } from './words/ngsl-05.js';

export const words = [
  ...core,
  ...tsl01, ...tsl02, ...tsl03, ...tsl04, ...tsl05, ...tsl06,
  ...ngsl01, ...ngsl02, ...ngsl03, ...ngsl04, ...ngsl05,
];
