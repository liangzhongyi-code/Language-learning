/**
 * 日文單字題庫的匯總入口。
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

export const words = [...core];
