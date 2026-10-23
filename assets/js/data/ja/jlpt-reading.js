/**
 * 日文 JLPT 讀解短文組的匯總入口。
 *
 * 每個題型一個批次檔，依短文、中文、長文、統合、主張、情報的順序接續連號（ja-jr-0001 起）；
 * 排除題目後後面的號碼往前補，schema 要求整份連號。
 * 由 tools/import-yomitaku.mjs 對照上游 Yomitaku 的固定 commit；
 * excluded 是依選組順序輪到、但本專案不收的短文組，每組都要寫原因。
 */
import { passages as tanbun, excluded as tanbunExcluded } from './jlpt-reading/n1-tanbun.js';
import { passages as chubun, excluded as chubunExcluded } from './jlpt-reading/n1-chubun.js';
import { passages as chobun, excluded as chobunExcluded } from './jlpt-reading/n1-chobun.js';
import { passages as togo, excluded as togoExcluded } from './jlpt-reading/n1-togo.js';
import { passages as shucho, excluded as shuchoExcluded } from './jlpt-reading/n1-shucho.js';
import { passages as joho, excluded as johoExcluded } from './jlpt-reading/n1-joho.js';

export const jlptReading = [...tanbun, ...chubun, ...chobun, ...togo, ...shucho, ...joho];

export const jlptReadingExcluded = [
  ...tanbunExcluded, ...chubunExcluded, ...chobunExcluded, ...togoExcluded, ...shuchoExcluded, ...johoExcluded,
];
